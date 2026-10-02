#!/usr/bin/env bash
# Deploy Raccoon to the team's Kubernetes namespace at http://<team-host>/app
# without Docker: the source is shipped as a tarball in a ConfigMap and built inside a
# public node:22-slim pod (needs outbound npm access from the cluster).
#
#   ./deploy/k8s.sh      # keys come from the environment or .env.local
#
# Follows the deploy-app-no-registry skill: same host as the VSS UI, Ingress path /app.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v kubectl >/dev/null || { echo "kubectl is not installed"; exit 1; }
mapfile -t KCFG < <(find /config -maxdepth 1 -type f -name '*-k8s.yaml' | sort)
export KUBECONFIG="${KUBECONFIG:-${KCFG[0]:-/config/kubeconfig}}"
mapfile -t CFG < <(find /config -maxdepth 1 -type f -name '*.config' | sort)
(( ${#CFG[@]} == 1 )) || { echo "expected exactly one /config/*.config"; exit 1; }
set -a; source "${CFG[0]}"; set +a

# .env.local fills anything not already exported (same precedence as Next.js).
if [[ -f .env.local ]]; then
  while IFS='=' read -r k v; do
    [[ "$k" =~ ^[A-Z_][A-Z0-9_]*$ && -z "${!k:-}" ]] && export "$k=${v%$'\r'}"
  done < <(grep -E '^[A-Z_][A-Z0-9_]*=.' .env.local)
fi
FAL_KEY="${FAL_KEY:-${FAL_AI_API_KEY:-}}"

# Cosmos + YOLO endpoints live in the VSS pipeline secret, not in <team>.config.
vss2() { awk -v k="$1" '$2=="key:" && $3==k {getline; sub(/^[^:]*value:[ \t]*/, ""); gsub(/"/, ""); print; exit}' /config/*-vss2-secret.yaml 2>/dev/null || true; }
if [[ -z "${COSMOS3_REASON_URL:-}" && -n "$(vss2 cosmos_host)" ]]; then
  scheme="$(vss2 cosmoshttpscheme)"
  COSMOS3_REASON_URL="${scheme:-http}://$(vss2 cosmos_host):$(vss2 cosmos_port)"
fi
COSMOS3_REASON_MODEL="${COSMOS3_REASON_MODEL:-$(vss2 cosmos_model)}"
if [[ -z "${YOLO_URL:-}" && -n "$(vss2 yolo_infer_host)" ]]; then
  YOLO_URL="http://$(vss2 yolo_infer_host):$(vss2 yolo_infer_port)"
fi

: "${ELEVENLABS_API_KEY:?set ELEVENLABS_API_KEY}"
: "${ELEVENLABS_AGENT_ID:?set ELEVENLABS_AGENT_ID (npm run agent:setup)}"
: "${FAL_KEY:?set FAL_KEY}"

NS="$USERNAME"
APP=accident-scrubber
HOST="${INGRESS_URL#http://}"; HOST="${HOST#https://}"; HOST="${HOST%%/*}"

echo "→ bundling source"
SRC=(package.json package-lock.json next.config.ts tsconfig.json postcss.config.mjs app components lib agent scripts)
[[ -d public ]] && SRC+=(public)
tar czf /tmp/scrubber-src.tgz --exclude=node_modules --exclude=.next --exclude=.git --exclude=.data \
  --exclude='.env*' "${SRC[@]}"
du -h /tmp/scrubber-src.tgz

kubectl -n "$NS" create configmap "$APP-src" --from-file=src.tgz=/tmp/scrubber-src.tgz \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n "$NS" create secret generic "$APP-env" \
  --from-literal=VSS_URL="$INGRESS_URL" \
  --from-literal=VSS_USERNAME="$USERNAME" \
  --from-literal=VSS_PASSWORD="$PASSWORD" \
  --from-literal=COSMOS3_REASON_URL="${COSMOS3_REASON_URL:-}" \
  --from-literal=COSMOS3_REASON_MODEL="${COSMOS3_REASON_MODEL:-}" \
  --from-literal=GPU_BEARER_TOKEN="${GPU_BEARER_TOKEN:-}" \
  --from-literal=YOLO_URL="${YOLO_URL:-}" \
  --from-literal=WANDB_API_KEY="${WANDB_API_KEY:-}" \
  --from-literal=WANDB_TEAM="${WANDB_TEAM:-}" \
  --from-literal=WANDB_PROJECT="${WANDB_PROJECT:-}" \
  --from-literal=ELEVENLABS_API_KEY="$ELEVENLABS_API_KEY" \
  --from-literal=ELEVENLABS_AGENT_ID="$ELEVENLABS_AGENT_ID" \
  --from-literal=FAL_KEY="$FAL_KEY" \
  --from-literal=FAL_EDIT_MODEL="${FAL_EDIT_MODEL:-google/gemini-omni-flash/v1.1/edit}" \
  --from-literal=FAL_EDIT_RESOLUTION="${FAL_EDIT_RESOLUTION:-720p}" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n "$NS" apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata: { name: $APP, labels: { app: $APP } }
spec:
  replicas: 1
  selector: { matchLabels: { app: $APP } }
  template:
    metadata: { labels: { app: $APP } }
    spec:
      containers:
      - name: app
        image: node:22-slim
        ports: [{ containerPort: 8080 }]
        envFrom: [{ secretRef: { name: $APP-env } }]
        env:
        - { name: NEXT_PUBLIC_BASE_PATH, value: "/app" }
        - { name: NEXT_TELEMETRY_DISABLED, value: "1" }
        command: ["bash", "-c"]
        args:
        - |
          set -euo pipefail
          mkdir -p /srv/app && tar xzf /bundle/src.tgz -C /srv/app && cd /srv/app
          # ffmpeg: Cosmos forklift/robot grounding and reel thumbnails. Optional; without it boxes are YOLO-only.
          (apt-get update -qq && apt-get install -y -qq --no-install-recommends ffmpeg >/dev/null) || echo "ffmpeg unavailable, continuing without it"
          npm ci --no-audit --no-fund
          npm run build
          exec npx next start -H 0.0.0.0 -p 8080
        volumeMounts: [{ name: src, mountPath: /bundle }]
        readinessProbe:
          httpGet: { path: /api/health?quick=1, port: 8080 }
          initialDelaySeconds: 60
          periodSeconds: 10
          failureThreshold: 60
      volumes:
      - name: src
        configMap: { name: $APP-src }
---
apiVersion: v1
kind: Service
metadata: { name: $APP, labels: { app: $APP } }
spec:
  selector: { app: $APP }
  ports: [{ name: http, port: 80, targetPort: 8080 }]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: $APP
  labels: { app: $APP }
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /\$2
    nginx.ingress.kubernetes.io/proxy-read-timeout: "180"
spec:
  ingressClassName: nginx
  rules:
  - host: $HOST
    http:
      paths:
      - path: /app(/|$)(.*)
        pathType: ImplementationSpecific
        backend: { service: { name: $APP, port: { number: 80 } } }
EOF

kubectl -n "$NS" rollout restart deploy/"$APP"
echo "→ building inside the pod (2–4 min). Follow with:"
echo "   kubectl -n $NS logs -f deploy/$APP"
echo "→ then open http://$HOST/app"
