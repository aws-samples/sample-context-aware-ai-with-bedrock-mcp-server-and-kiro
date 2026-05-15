"""
LangChain-based MCP Server for Bedrock Knowledge Base.

This is an alternative to the official awslabs.bedrock-kb-retrieval-mcp-server,
demonstrating how to build a custom MCP server using LangChain as the
orchestration layer. Use this when you need:
  - Provider portability (swap Bedrock for OpenAI, Ollama, etc.)
  - LCEL chain composition (Retriever → Prompt → LLM → Parse)
  - min_score_confidence filtering to drop low-relevance results
  - Custom prompt templates for developer-focused answers
  - CloudWatch productivity metrics

Deployment:
  1. Deploy infrastructure first: cd infrastructure && npx cdk deploy --all
  2. Install deps: pip install -r requirements.txt
  3. Copy .env.example to .env and set KNOWLEDGE_BASE_ID from CDK outputs
  4. Update .kiro/settings/mcp.json to point at this server (see mcp-config-langchain.json)
  5. Kiro will spawn this server automatically when you ask a question
"""

import atexit
import os
import logging
import time
from typing import Optional

from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field

from kb_retriever import KnowledgeBaseRetriever
from metrics import MetricsEmitter

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
KNOWLEDGE_BASE_ID = os.environ["KNOWLEDGE_BASE_ID"]
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
MODEL_ID = os.environ.get("MODEL_ID", "anthropic.claude-3-sonnet-20240229-v1:0")
MAX_RESULTS = int(os.environ.get("MAX_RESULTS", "5"))

# ---------------------------------------------------------------------------
# Initialize retriever and metrics
# ---------------------------------------------------------------------------
retriever = KnowledgeBaseRetriever(
    knowledge_base_id=KNOWLEDGE_BASE_ID,
    region=AWS_REGION,
    model_id=MODEL_ID,
    max_results=MAX_RESULTS,
    min_score_confidence=0.5,
)

metrics = MetricsEmitter(region=AWS_REGION)
atexit.register(metrics.stop)

# ---------------------------------------------------------------------------
# MCP Server
# ---------------------------------------------------------------------------
mcp = FastMCP(
    "kiro-bedrock-kb-langchain",
)


class RetrieveFilter(BaseModel):
    document_type: Optional[str] = Field(
        default=None,
        description="Filter by document type: adr, api-spec, security, coding-standards, all",
    )


@mcp.tool()
async def retrieve_knowledge(
    query: str,
    max_results: int = MAX_RESULTS,
    filter: Optional[RetrieveFilter] = None,
) -> str:
    """Search the organizational knowledge base for relevant documentation,
    ADRs, API specs, security guidelines, and coding standards.
    Returns the most relevant passages with source attribution."""

    start = time.time()
    doc_type = None
    if filter and filter.document_type and filter.document_type != "all":
        doc_type = filter.document_type

    try:
        results = retriever.retrieve(
            query=query,
            max_results=max_results,
            document_type=doc_type,
        )

        latency_ms = (time.time() - start) * 1000
        metrics.record_retrieval(latency_ms, len(results))
        metrics.record_productivity_event("retrieve")

        if not results:
            return "No relevant documents found. Try rephrasing or broadening your search."

        formatted = []
        for i, doc in enumerate(results, 1):
            source = doc.metadata.get("source", "Unknown source")
            score = doc.metadata.get("score")
            score_str = f" (relevance: {score * 100:.1f}%)" if score else ""
            formatted.append(
                f"### Result {i}{score_str}\n**Source:** {source}\n\n{doc.page_content}"
            )

        return "\n\n---\n\n".join(formatted)

    except Exception as e:
        metrics.record_error()
        raise


@mcp.tool()
async def ask_knowledge_base(
    question: str,
    context: Optional[str] = None,
) -> str:
    """Ask a question and get a synthesized answer from the knowledge base.
    Uses LangChain's RetrievalQA chain to combine relevant documents
    into a coherent response with citations."""

    start = time.time()
    try:
        full_question = (
            f"Context: {context}\n\nQuestion: {question}" if context else question
        )
        answer = retriever.ask(full_question)

        latency_ms = (time.time() - start) * 1000
        metrics.record_retrieval(latency_ms, 1)
        metrics.record_productivity_event("ask")

        return answer

    except Exception as e:
        metrics.record_error()
        raise


@mcp.tool()
async def list_knowledge_sources() -> str:
    """List the types of documentation available in the knowledge base."""
    sources = [
        "📐 **Architecture Decision Records (ADRs)** — Past architectural decisions and their rationale",
        "📡 **API Specifications** — REST/GraphQL API documentation and schemas",
        "🔒 **Security Guidelines** — Authentication, authorization, and security best practices",
        "📝 **Coding Standards** — Language-specific style guides and conventions",
        "🔄 **Circuit Breaker Patterns** — Resilience patterns and implementation guides",
        "🚀 **Deployment Runbooks** — Step-by-step deployment and rollback procedures",
    ]
    return f"# Available Knowledge Sources\n\n" + "\n".join(sources)


def main():
    """Run the MCP server over stdio."""
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
