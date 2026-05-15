# Deployment Runbook

## Pre-Deployment Checklist
- [ ] All tests passing in CI (unit, integration, e2e)
- [ ] Code review approved by at least 2 reviewers
- [ ] Security scan clean (no high/critical findings)
- [ ] Database migrations tested in staging
- [ ] Feature flags configured for gradual rollout
- [ ] Rollback plan documented and tested

## Deployment Process

### 1. Deploy to Staging
```bash
# Trigger staging deployment
aws codepipeline start-pipeline-execution \
  --name acme-orders-staging

# Verify health
curl -s https://staging-api.acme.com/orders/v1/health | jq .
```

### 2. Run Smoke Tests
```bash
npm run test:smoke -- --env staging
```

### 3. Deploy to Production (Canary)
```bash
# Start canary deployment (10% traffic)
aws codedeploy create-deployment \
  --application-name orders-service \
  --deployment-group-name prod-canary \
  --deployment-config-name CodeDeployDefault.LambdaCanary10Percent10Minutes

# Monitor canary metrics
aws cloudwatch get-metric-data \
  --metric-data-queries file://canary-metrics-query.json \
  --start-time $(date -u -v-10M +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S)
```

### 4. Full Rollout
After 10 minutes with healthy canary metrics:
- Error rate < 0.1%
- P99 latency < 500ms
- No circuit breaker trips

The deployment automatically promotes to 100%.

## Rollback Procedure
```bash
# Immediate rollback
aws codedeploy stop-deployment \
  --deployment-id <deployment-id> \
  --auto-rollback-enabled

# Verify rollback
curl -s https://api.acme.com/orders/v1/health | jq .version
```

## Key Metrics to Monitor
| Metric                  | Threshold | Action              |
|-------------------------|-----------|---------------------|
| Error rate (5xx)        | > 1%      | Auto-rollback       |
| P99 latency             | > 1s      | Alert + investigate  |
| Circuit breaker trips   | > 0       | Alert + investigate  |
| CPU utilization         | > 80%     | Scale out            |
| Memory utilization      | > 85%     | Investigate leak     |
