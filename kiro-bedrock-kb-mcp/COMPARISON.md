# AWS SDK vs LangChain: Side-by-Side Comparison

Both implementations expose identical MCP tools to Kiro CLI. The difference
is in the orchestration layer underneath.

## When to Choose Each

| Criteria                  | AWS SDK (TypeScript)                  | LangChain (Python)                    |
|---------------------------|---------------------------------------|---------------------------------------|
| Minimal dependencies      | ✅ Only AWS SDK + MCP SDK             | ❌ LangChain + boto3 + MCP           |
| Provider portability      | ❌ AWS-only                           | ✅ Swap to OpenAI, local models, etc.|
| Chain composition         | Manual                                | Built-in LCEL                         |
| Relevance filtering       | Manual score threshold                | Built-in `min_score_confidence`       |
| Embeddings access         | Not exposed                           | `BedrockEmbeddings` for custom use    |
| Tracing / observability   | Amazon CloudWatch                     | LangSmith + Amazon CloudWatch         |
| Language                  | TypeScript                            | Python                                |
| Cold start performance    | Faster                                | Slower (Python + deps)                |
| Team familiarity          | JS/TS teams                           | Python / ML teams                     |

## Code Comparison: Retrieve and Generate

### AWS SDK (TypeScript) — ~25 lines
```typescript
const command = new RetrieveAndGenerateCommand({
  input: { text: question },
  retrieveAndGenerateConfiguration: {
    type: "KNOWLEDGE_BASE",
    knowledgeBaseConfiguration: {
      knowledgeBaseId: KB_ID,
      modelArn: MODEL_ARN,
    },
  },
});
const response = await client.send(command);
return response.output?.text;
```

### LangChain (Python) — ~15 lines
```python
retriever = AmazonKnowledgeBasesRetriever(
    knowledge_base_id=KB_ID,
    region_name=REGION,
    min_score_confidence=0.5,  # filter low-relevance results
)
llm = ChatBedrockConverse(model=MODEL_ID, region_name=REGION)

chain = (
    {"context": retriever | format_docs, "question": RunnablePassthrough()}
    | prompt_template
    | llm
    | StrOutputParser()
)
answer = chain.invoke(question)
```

## LangChain-Specific Features

### Relevance Filtering
`min_score_confidence` (0.0–1.0) drops results below the threshold before
they reach the LLM, reducing noise and hallucination risk:

```python
retriever = AmazonKnowledgeBasesRetriever(
    knowledge_base_id=KB_ID,
    region_name=REGION,
    min_score_confidence=0.5,  # only results with 50%+ relevance
)
```

### Explicit Embeddings Access
`BedrockEmbeddings` gives you direct access to the same embedding model
the Knowledge Base uses — useful for custom similarity, caching, or
hybrid search:

```python
from langchain_aws import BedrockEmbeddings

embeddings = BedrockEmbeddings(
    model_id="amazon.titan-embed-text-v2:0",
    region_name=REGION,
)
vector = embeddings.embed_query("circuit breaker pattern")
```

## Switching Providers with LangChain

The key advantage of LangChain: swap the LLM with a single line change.

```python
# Amazon Bedrock (Converse API)
from langchain_aws import ChatBedrockConverse
llm = ChatBedrockConverse(model="anthropic.claude-3-sonnet-20240229-v1:0")

# OpenAI (same chain, different provider)
from langchain_openai import ChatOpenAI
llm = ChatOpenAI(model="gpt-4o")

# Local model via Ollama
from langchain_ollama import ChatOllama
llm = ChatOllama(model="llama3")
```

The retrieval chain, prompt template, and MCP tools remain unchanged.
