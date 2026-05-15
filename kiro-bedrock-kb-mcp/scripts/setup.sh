#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Setup script for Kiro + Bedrock Knowledge Base MCP integration
# Uses the official awslabs.bedrock-kb-retrieval-mcp-server
# ============================================================================

echo "🚀 Setting up Kiro Bedrock KB MCP integration..."

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "❌ Node.js is required. Install from https://nodejs.org"; exit 1; }
command -v aws >/dev/null 2>&1 || { echo "❌ AWS CLI is required. Install from https://aws.amazon.com/cli/"; exit 1; }
command -v npx >/dev/null 2>&1 || { echo "❌ npx is required (comes with Node.js)"; exit 1; }
command -v uvx >/dev/null 2>&1 || { echo "❌ uvx is required. Install uv from https://docs.astral.sh/uv/getting-started/installation/"; exit 1; }

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js 18+ required. Current: $(node -v)"
  exit 1
fi

echo "✅ Prerequisites check passed"

# Step 1: Deploy infrastructure
echo ""
echo "📦 Step 1: Deploying AWS infrastructure..."
pushd infrastructure > /dev/null
npm install

# Bundle the Lambda that creates the OpenSearch vector index
echo "   Bundling Lambda dependencies..."
bash lib/aoss-index-handler/bundle.sh

npx cdk bootstrap
npx cdk deploy --all --require-approval never --outputs-file ../cdk-outputs.json
popd > /dev/null

# Extract outputs
KB_ID=$(jq -r '.KiroBedrockKBStack.KnowledgeBaseId' cdk-outputs.json)
DOCS_BUCKET=$(jq -r '.KiroBedrockKBStack.DocsBucketName' cdk-outputs.json)

echo "✅ Infrastructure deployed"
echo "   Knowledge Base ID: $KB_ID"
echo "   Docs Bucket:       $DOCS_BUCKET"

# Step 2: Trigger knowledge base ingestion
echo ""
echo "🔄 Step 2: Starting knowledge base ingestion..."
aws bedrock-agent start-ingestion-job \
  --knowledge-base-id "$KB_ID" \
  --data-source-id "$(jq -r '.KiroBedrockKBStack.DataSourceId' cdk-outputs.json)" \
  --region "${AWS_REGION:-us-east-1}"
echo "✅ Ingestion job started (takes 2-3 minutes)"

# Step 3: Verify MCP server can run
echo ""
echo "🔨 Step 3: Verifying MCP server availability..."
uvx awslabs.bedrock-kb-retrieval-mcp-server@latest --help > /dev/null 2>&1 && \
  echo "✅ Official Bedrock KB MCP server is available" || \
  echo "⚠️  Could not verify MCP server. Ensure uvx is installed and working."

# Done
echo ""
echo "============================================"
echo "✅ Setup complete!"
echo ""
echo "The Kiro MCP config at .kiro/settings/mcp.json is pre-configured"
echo "to use the official awslabs.bedrock-kb-retrieval-mcp-server."
echo ""
echo "The Knowledge Base is tagged with mcp-multirag-kb=true so the"
echo "MCP server will discover it automatically."
echo ""
echo "Usage with Kiro:"
echo "  Ask: \"What's our circuit breaker pattern?\""
echo "  Ask: \"Show me the Orders API authentication requirements\""
echo "  Ask: \"What are our coding standards for error handling?\""
echo ""
echo "To add more documents:"
echo "  1. Add files to sample-knowledge-base/"
echo "  2. Run: ./scripts/sync-knowledge-base.sh"
echo "============================================"
