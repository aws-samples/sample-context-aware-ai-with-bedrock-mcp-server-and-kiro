# Testing Guide — Connecting to Both MCP Servers from Kiro

This guide walks you through connecting to the **official AWS Bedrock KB MCP server** and the **LangChain custom MCP server** side-by-side, then testing them with sample questions.

## Prerequisites

- Infrastructure deployed (`./scripts/setup.sh` or manual CDK deploy)
- Document ingestion complete (Knowledge Base status: ACTIVE)
- Valid AWS credentials (`aws sts get-caller-identity` succeeds)
- Kiro CLI installed
- Python venv set up for LangChain server (`cd langchain-alternative && pip install -r requirements.txt`)

## Step 1: Set Up AWS Credentials

The MCP servers read credentials from `~/.aws/credentials`. If you use temporary credentials, update the default profile:

```bash
aws configure set aws_access_key_id <YOUR_KEY> --profile default
aws configure set aws_secret_access_key <YOUR_SECRET> --profile default
aws configure set aws_session_token <YOUR_TOKEN> --profile default
aws configure set region us-east-1 --profile default
```

Verify:

```bash
aws sts get-caller-identity
```

## Step 2: Configure Both MCP Servers

Edit `.kiro/settings/mcp.json` to include both servers:

```json
{
  "mcpServers": {
    "awslabs.bedrock-kb-retrieval-mcp-server": {
      "command": "uvx",
      "args": ["awslabs.bedrock-kb-retrieval-mcp-server@latest"],
      "env": {
        "AWS_PROFILE": "default",
        "AWS_REGION": "us-east-1",
        "FASTMCP_LOG_LEVEL": "ERROR",
        "KB_INCLUSION_TAG_KEY": "mcp-multirag-kb",
        "BEDROCK_KB_RERANKING_ENABLED": "false"
      },
      "disabled": false,
      "autoApprove": ["ListKnowledgeBases", "QueryKnowledgeBases"]
    },
    "bedrock-kb-langchain": {
      "command": "<ABSOLUTE_PATH_TO>/langchain-alternative/.venv/bin/python",
      "args": ["<ABSOLUTE_PATH_TO>/langchain-alternative/mcp_server.py"],
      "env": {
        "KNOWLEDGE_BASE_ID": "<YOUR_KB_ID>",
        "AWS_REGION": "us-east-1",
        "MODEL_ID": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        "MAX_RESULTS": "5"
      },
      "disabled": false,
      "autoApprove": ["retrieve_knowledge", "ask_knowledge_base", "list_knowledge_sources"]
    }
  }
}
```

Replace the placeholders:

```bash
# Get your Knowledge Base ID
jq -r '.KiroBedrockKBStack.KnowledgeBaseId' cdk-outputs.json

# Get the absolute path to the LangChain venv
echo "$(pwd)/langchain-alternative/.venv/bin/python"
echo "$(pwd)/langchain-alternative/mcp_server.py"
```

> **Note on MODEL_ID**: Use an inference profile ID (e.g., `us.anthropic.claude-haiku-4-5-20251001-v1:0`), not a raw model ID. Newer Bedrock models require inference profiles for on-demand invocation.

## Step 3: Restart the IDE

Quit and relaunch the IDE (Cmd+Q on macOS). MCP servers start as child processes when the IDE launches — they won't pick up config changes without a full restart.

After restart, both servers will be running. You'll have access to five tools:

| Server | Tool | What It Does |
|--------|------|-------------|
| Official | `ListKnowledgeBases` | Lists all KBs tagged with `mcp-multirag-kb` |
| Official | `QueryKnowledgeBases` | Vector search — returns raw document chunks with scores |
| LangChain | `list_knowledge_sources` | Lists available document types in the KB |
| LangChain | `retrieve_knowledge` | Vector search with `min_score_confidence` filtering |
| LangChain | `ask_knowledge_base` | Full RAG — retrieves docs, synthesizes an answer with citations |

## Step 4: Test with Sample Questions

### Basic Retrieval (both servers handle these)

Ask these in Kiro — the agent will pick the appropriate tool:

| Question | Expected Source |
|----------|----------------|
| "What is our circuit breaker failure threshold?" | ADR-001 — returns config table (5 failures, 30s reset) |
| "How do we handle order events?" | ADR-002 — returns EventBridge event schema and types |
| "What are our TypeScript naming conventions?" | coding-standards.md — returns naming rules |
| "What authentication does the Orders API require?" | api-spec-orders.md — returns JWT/scope requirements |
| "What's the deployment rollback procedure?" | deployment-runbook.md — returns canary steps |

### RAG Generation (LangChain `ask_knowledge_base` only)

These questions work best with the LangChain server because they need a synthesized answer, not just raw chunks:

| Question | What You Get |
|----------|-------------|
| "How should I implement error handling in our TypeScript services?" | Synthesized answer combining coding-standards.md patterns with code examples |
| "What happens when a downstream service is unresponsive?" | Answer combining circuit breaker ADR + fallback strategies |
| "Walk me through deploying a new version of the orders service" | Step-by-step answer from deployment-runbook.md with rollback criteria |
| "What security headers should our APIs return?" | Answer from security-guidelines.md with specific header values |

### Comparison Test

Ask the **same question** to see the difference between raw retrieval and RAG:

> "What happens when the circuit breaker trips?"

- **Official server** (`QueryKnowledgeBases`) → returns the raw ADR-001 document chunk with a relevance score
- **LangChain** (`retrieve_knowledge`) → returns the same chunk but filtered by min confidence (0.5)
- **LangChain** (`ask_knowledge_base`) → returns a synthesized answer: "When the circuit breaker trips after 5 consecutive failures, read operations return cached data with an `X-Degraded: true` header, and write operations queue to SQS and return 202 Accepted. The circuit enters half-open state after 30 seconds..." with source citations

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `UnrecognizedClientException: security token invalid` | Refresh AWS credentials and restart the IDE |
| `ResourceNotFoundException: model marked as Legacy` | Update `MODEL_ID` to an active inference profile (see Step 2) |
| LangChain server not appearing in tools | Check the `command` path points to the `.venv/bin/python` absolute path |
| `No relevant documents found` | Run `./scripts/sync-knowledge-base.sh` to re-ingest documents |
| Official server doesn't find any KBs | Verify the KB has the tag `mcp-multirag-kb=true` |

## Switching Between Servers

To use **only the official server**, set `"disabled": true` on `bedrock-kb-langchain` in `mcp.json`.

To use **only the LangChain server**, set `"disabled": true` on `awslabs.bedrock-kb-retrieval-mcp-server`.

To use **both simultaneously**, set `"disabled": false` on both (default in this guide).

Restart the IDE after any config change.
