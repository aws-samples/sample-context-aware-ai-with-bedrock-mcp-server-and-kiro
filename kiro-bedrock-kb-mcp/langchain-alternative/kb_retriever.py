"""
LangChain-based Knowledge Base Retriever.

Wraps Amazon Bedrock Knowledge Bases using LangChain's retriever
abstraction. This makes it trivial to swap the underlying provider —
change one class and the rest of the pipeline stays identical.

Comparison with direct AWS SDK approach:
  - AWS SDK: ~80 lines of retrieval + generation logic
  - LangChain: ~40 lines, with built-in chain composition

The trade-off is an extra dependency, but you gain provider portability
and access to LangChain's ecosystem (caching, callbacks, tracing).

Uses langchain-aws v0.2.14+ APIs:
  - AmazonKnowledgeBasesRetriever with min_score_confidence filtering
  - ChatBedrockConverse for the Converse API (unified interface)
  - BedrockEmbeddings for explicit embedding control
"""

import logging
from typing import Optional

from langchain_aws import BedrockEmbeddings, ChatBedrockConverse
from langchain_aws.retrievers import AmazonKnowledgeBasesRetriever
from langchain_core.documents import Document
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnablePassthrough

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Prompt template — identical intent to the TypeScript version
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = """\
You are a senior software engineering assistant with deep knowledge of the \
team's architecture, APIs, security guidelines, and coding standards.

Using ONLY the provided context, give a clear, actionable answer.
Include code examples when relevant. Cite sources using [Source: filename].

If the context doesn't contain enough information, say so explicitly \
rather than making up an answer."""

QA_TEMPLATE = ChatPromptTemplate.from_messages(
    [
        ("system", SYSTEM_PROMPT),
        (
            "human",
            "Context:\n{context}\n\nQuestion: {question}\n\nAnswer:",
        ),
    ]
)


def _format_docs(docs: list[Document]) -> str:
    """Concatenate document contents for the prompt context window."""
    return "\n\n---\n\n".join(
        f"[Source: {doc.metadata.get('source', 'unknown')}]\n{doc.page_content}"
        for doc in docs
    )


class KnowledgeBaseRetriever:
    """Unified retriever wrapping LangChain + Amazon Bedrock Knowledge Bases.

    Supports:
      - min_score_confidence filtering to drop low-relevance results
      - Bedrock Converse API for unified model interface
      - BedrockEmbeddings for explicit embedding model access
      - LCEL chain composition for Retrieve-and-Generate
    """

    def __init__(
        self,
        knowledge_base_id: str,
        region: str,
        model_id: str,
        max_results: int = 5,
        min_score_confidence: Optional[float] = None,
    ):
        self.knowledge_base_id = knowledge_base_id
        self.region = region
        self.max_results = max_results

        # LangChain retriever backed by Amazon Bedrock Knowledge Bases.
        # min_score_confidence filters out results below the threshold
        # (0.0 to 1.0) — useful for reducing noise in answers.
        self.retriever = AmazonKnowledgeBasesRetriever(
            knowledge_base_id=knowledge_base_id,
            region_name=region,
            retrieval_config={
                "vectorSearchConfiguration": {
                    "numberOfResults": max_results,
                }
            },
            min_score_confidence=min_score_confidence,
        )

        # Embeddings model — same Titan model used by the Knowledge Base.
        # Exposed here so callers can embed queries independently if needed
        # (e.g., for custom similarity comparisons or caching).
        self.embeddings = BedrockEmbeddings(
            model_id="amazon.titan-embed-text-v2:0",
            region_name=region,
        )

        # LLM for generation — uses the Converse API which provides a
        # unified interface across all Bedrock models.
        self.llm = ChatBedrockConverse(
            model=model_id,
            region_name=region,
            temperature=0,
            max_tokens=2048,
        )

        # LCEL chain: Retriever → Format → Prompt → LLM → Parse
        # This is the core pipeline. Each stage is a Runnable that
        # transforms data and passes it to the next stage.
        self.qa_chain = (
            {
                "context": self.retriever | _format_docs,
                "question": RunnablePassthrough(),
            }
            | QA_TEMPLATE
            | self.llm
            | StrOutputParser()
        )

    def retrieve(
        self,
        query: str,
        max_results: Optional[int] = None,
        document_type: Optional[str] = None,
    ) -> list[Document]:
        """Retrieve relevant documents from the knowledge base.

        Args:
            query: Natural language search query.
            max_results: Override default max results.
            document_type: Optional filter by document type metadata.

        Returns:
            List of LangChain Document objects with content and metadata.
        """
        docs = self.retriever.invoke(query)

        if document_type:
            docs = [
                d
                for d in docs
                if d.metadata.get("document_type") == document_type
            ]

        if max_results:
            docs = docs[:max_results]

        return docs

    def ask(self, question: str) -> str:
        """Ask a question and get a synthesized answer with citations.

        Uses LangChain's LCEL chain: Retriever → Format → LLM → Parse.

        Args:
            question: The question to answer.

        Returns:
            Synthesized answer string.
        """
        return self.qa_chain.invoke(question)
