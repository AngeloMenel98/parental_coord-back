# Secret Management for Parental Coordination Backend

This document describes how to manage secrets for the Kubernetes deployment.

## Option 1: Plain Kubernetes Secrets (dev only)

For local development with minikube, you can apply secrets directly:

```bash
# Generate a strong JWT secret
JWT_SECRET=$(openssl rand -base64 32)

# Create the app secret
kubectl create secret generic app-secret \
  --from-literal=JWT_SECRET="$JWT_SECRET" \
  --from-literal=DB_USER="parental" \
  --from-literal=DB_PASSWORD="parental_secret" \
  --dry-run=client -o yaml | kubectl apply -f -

# Create the postgres secret
kubectl create secret generic postgres-secret \
  --from-literal=POSTGRES_USER="parental" \
  --from-literal=POSTGRES_PASSWORD="parental_secret" \
  --from-literal=POSTGRES_DB="parental_coordination" \
  --dry-run=client -o yaml | kubectl apply -f -
```

## Option 2: SealedSecrets (recommended for GitOps)

1. Install bitnami-labs/sealed-secrets in your cluster.
2. Use `kubeseal` to encrypt secrets:

```bash
# Create a temporary plain secret, then seal it
kubectl create secret generic app-secret \
  --from-literal=JWT_SECRET="$(openssl rand -base64 32)" \
  --from-literal=DB_USER="parental" \
  --from-literal=DB_PASSWORD="$(openssl rand -base64 32)" \
  --dry-run=client -o yaml | kubeseal -o yaml > k8s/app-sealedsecret.yaml
```

3. Delete the plain secret and commit only the SealedSecret YAML.

## Option 3: ExternalSecrets (cloud-managed)

If using AWS Secrets Manager, GCP Secret Manager, or Azure Key Vault:

1. Install the External Secrets Operator.
2. Create an `ExternalSecret` resource that references the cloud secret:

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: app-secret
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-manager
    kind: ClusterSecretStore
  target:
    name: app-secret
  data:
    - secretKey: JWT_SECRET
      remoteRef:
        key: parental-coordination/app-secret
        property: JWT_SECRET
```

## Generating Strong Secrets

```bash
# JWT secret (32 bytes base64-encoded)
openssl rand -base64 32

# Database password
openssl rand -base64 32
```

## Reference: Expected Secret Keys

See `k8s/secret-template.yaml` for the expected keys in each Secret resource.
