#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Sync local documents to S3 and trigger knowledge base re-ingestion
# ============================================================================

if [ ! -f "cdk-outputs.json" ]; then
  echo "❌ cdk-outputs.json not found. Run setup.sh first."
  exit 1
fi

KB_ID=$(jq -r '.KiroBedrockKBStack.KnowledgeBaseId' cdk-outputs.json)
DS_ID=$(jq -r '.KiroBedrockKBStack.DataSourceId' cdk-outputs.json)
BUCKET=$(jq -r '.KiroBedrockKBStack.DocsBucketName' cdk-outputs.json)
REGION="${AWS_REGION:-us-east-1}"

echo "📤 Uploading documents to S3..."
aws s3 sync sample-knowledge-base/ "s3://${BUCKET}/documents/" \
  --delete \
  --region "$REGION"

echo "🔄 Starting ingestion job..."
JOB_ID=$(aws bedrock-agent start-ingestion-job \
  --knowledge-base-id "$KB_ID" \
  --data-source-id "$DS_ID" \
  --region "$REGION" \
  --query 'ingestionJob.ingestionJobId' \
  --output text)

echo "⏳ Waiting for ingestion to complete (job: $JOB_ID)..."
while true; do
  STATUS=$(aws bedrock-agent get-ingestion-job \
    --knowledge-base-id "$KB_ID" \
    --data-source-id "$DS_ID" \
    --ingestion-job-id "$JOB_ID" \
    --region "$REGION" \
    --query 'ingestionJob.status' \
    --output text)

  echo "   Status: $STATUS"

  if [ "$STATUS" = "COMPLETE" ]; then
    echo "✅ Ingestion complete!"
    break
  elif [ "$STATUS" = "FAILED" ]; then
    echo "❌ Ingestion failed. Check AWS Console for details."
    exit 1
  fi

  sleep 10
done
