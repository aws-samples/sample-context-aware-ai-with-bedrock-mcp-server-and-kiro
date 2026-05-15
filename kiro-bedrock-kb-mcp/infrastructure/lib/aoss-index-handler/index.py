"""
Custom Resource Lambda: creates the vector index inside an
OpenSearch Serverless collection.

Based on the official AWS sample:
https://github.com/aws-samples/amazon-bedrock-samples/tree/main/rag

CloudFormation cannot create AOSS indexes natively — this Lambda
bridges that gap so the entire deployment is fully automated.
"""

import json
import time
import boto3
from opensearchpy import OpenSearch, RequestsHttpConnection, AWSV4SignerAuth


def on_event(event, context):
    print(json.dumps(event))
    request_type = event["RequestType"]

    if request_type == "Create":
        return on_create(event)
    if request_type == "Update":
        return on_create(event)
    if request_type == "Delete":
        return on_delete(event)

    raise ValueError(f"Unknown request type: {request_type}")


def wait_for_collection_active(collection_name, max_wait_seconds=600):
    """Poll AOSS API until the collection status is ACTIVE.
    Matches the pattern from the official AWS Bedrock samples."""
    client = boto3.client("opensearchserverless")
    start = time.time()

    while time.time() - start < max_wait_seconds:
        response = client.batch_get_collection(names=[collection_name])
        details = response.get("collectionDetails", [])

        if details:
            status = details[0].get("status")
            collection_id = details[0].get("id")
            print(f"Collection '{collection_name}' status: {status}")
            if status == "ACTIVE":
                return collection_id
            if status in ("FAILED", "DELETING"):
                raise RuntimeError(
                    f"Collection '{collection_name}' is in {status} state"
                )

        print("Creating collection...")
        time.sleep(30)

    raise TimeoutError(
        f"Collection '{collection_name}' not ACTIVE after {max_wait_seconds}s"
    )


def get_client(host):
    """Build an OpenSearch client with SigV4 auth for AOSS.
    Matches the pattern from the official AWS Bedrock samples."""
    region = boto3.session.Session().region_name or "us-east-1"
    credentials = boto3.Session().get_credentials()
    auth = AWSV4SignerAuth(credentials, region, "aoss")

    return OpenSearch(
        hosts=[{"host": host, "port": 443}],
        http_auth=auth,
        use_ssl=True,
        verify_certs=True,
        connection_class=RequestsHttpConnection,
        timeout=300,
    )


def on_create(event):
    props = event["ResourceProperties"]
    collection_name = props["CollectionName"]
    index_name = props["IndexName"]
    embedding_dimension = int(props.get("EmbeddingDimension", "1024"))

    region = boto3.session.Session().region_name or "us-east-1"

    # Step 1: Wait for collection to be ACTIVE via AOSS API
    print(f"Waiting for collection '{collection_name}' to be ACTIVE...")
    collection_id = wait_for_collection_active(collection_name)

    # Step 2: Construct host from collection ID (official AWS sample pattern)
    host = f"{collection_id}.{region}.aoss.amazonaws.com"
    print(f"Collection ACTIVE. Host: {host}")

    # Step 3: Wait for data access policies to propagate
    # The official AWS sample waits 60s after policy creation.
    print("Waiting 60s for data access policies to propagate...")
    time.sleep(60)

    # Step 4: Connect and create the index
    client = get_client(host)

    # Index body matching the official AWS Bedrock samples
    body_json = {
        "settings": {
            "index.knn": "true",
            "number_of_shards": 1,
            "knn.algo_param.ef_search": 512,
            "number_of_replicas": 0,
        },
        "mappings": {
            "properties": {
                "embedding": {
                    "type": "knn_vector",
                    "dimension": embedding_dimension,
                    "method": {
                        "name": "hnsw",
                        "engine": "faiss",
                        "space_type": "l2",
                    },
                },
                "text": {
                    "type": "text",
                },
                "metadata": {
                    "type": "text",
                },
            }
        },
    }

    for attempt in range(5):
        try:
            if client.indices.exists(index=index_name):
                print(f"Index '{index_name}' already exists, skipping.")
                return {"PhysicalResourceId": index_name}

            response = client.indices.create(
                index=index_name, body=json.dumps(body_json)
            )
            print(f"Index created: {json.dumps(response, default=str)}")

            # Wait for index to be fully ready (official sample waits 60s)
            print("Waiting 60s for index to be ready...")
            time.sleep(60)

            return {"PhysicalResourceId": index_name}

        except Exception as e:
            print(f"Index creation attempt {attempt + 1}/5 failed: {e}")
            if attempt < 4:
                time.sleep(30)
            else:
                raise


def on_delete(event):
    props = event["ResourceProperties"]
    collection_name = props["CollectionName"]
    index_name = props["IndexName"]

    try:
        region = boto3.session.Session().region_name or "us-east-1"
        aoss_client = boto3.client("opensearchserverless")
        response = aoss_client.batch_get_collection(names=[collection_name])
        details = response.get("collectionDetails", [])

        if details and details[0].get("status") == "ACTIVE":
            collection_id = details[0]["id"]
            host = f"{collection_id}.{region}.aoss.amazonaws.com"
            client = get_client(host)
            if client.indices.exists(index=index_name):
                client.indices.delete(index=index_name)
                print(f"Index '{index_name}' deleted.")
        else:
            print("Collection not active, skipping index deletion.")
    except Exception as e:
        print(f"Error deleting index (may already be gone): {e}")

    return {"PhysicalResourceId": index_name}
