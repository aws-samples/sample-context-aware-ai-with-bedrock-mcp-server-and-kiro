# Security Policy

## Disclaimer

This project is provided as sample/educational code and is NOT intended for production use without
additional security hardening. See the "Production Hardening Recommendations" section below.

## Reporting Vulnerabilities

If you discover a security vulnerability in this project, please report it by emailing
aws-security@amazon.com. Do not report security vulnerabilities through public GitHub issues.

## AWS Services Used

- Amazon Bedrock Knowledge Bases — orchestrates document embedding and retrieval
- Amazon OpenSearch Serverless — vector store for document embeddings
- Amazon S3 — stores knowledge base documents and access logs
- AWS Lambda — creates OpenSearch index via custom resource
- AWS KMS — encrypts SNS alert topic
- Amazon SNS — delivers CloudWatch alarm notifications
- Amazon CloudWatch — monitoring dashboard and alarms
- Amazon VPC — network isolation for OpenSearch endpoint
- AWS IAM — least-privilege access for all services

## Prerequisites and Permissions

To deploy this solution, you need:

- An AWS account with permissions to create VPC, S3, OpenSearch Serverless, Bedrock, Lambda, KMS, SNS, CloudWatch, and IAM resources
- AWS CLI v2 configured with appropriate credentials
- Node.js 18+, AWS CDK, and Python 3.11+
- Amazon Bedrock model access enabled for Titan Text Embeddings v2 and Claude 3.5 Haiku

## Known Security Considerations

| Item | Category | Rationale |
|------|----------|-----------|
| `aoss:BatchGetCollection` with Resource: "*" | Security Debt | OpenSearch Serverless does not support resource-level permissions for this action |
| `cloudwatch:PutMetricData` with Resource: "*" | Security Debt | CloudWatch PutMetricData does not support resource-level permissions; namespace condition applied |
| Lambda env vars use default encryption | Security Debt | No sensitive data in Lambda environment variables for this project |
| CloudWatch Logs use default encryption | Security Debt | Logs contain operational metrics only, no sensitive customer data |
| S3 buckets use RemovalPolicy.DESTROY | Sample Code | Production deployments should use RETAIN with deletion protection |
| OpenSearch Serverless uses AWS-owned key | Sample Code | Production should use customer-managed KMS key for data sovereignty |

## Production Hardening Recommendations

Before using this code in a production environment, implement the following changes:

- **IAM**: Replace any remaining wildcard resources with specific ARNs. Create a custom IAM policy with minimum required permissions instead of using managed FullAccess policies.
- **Encryption**: Use customer-managed KMS keys for OpenSearch Serverless, S3, and CloudWatch Logs.
- **Networking**: Remove `AllowFromPublic: true` from the OpenSearch network policy. Restrict access to VPC endpoint only.
- **Deletion protection**: Change `removalPolicy` to `RETAIN` for S3 buckets and KMS keys. Enable S3 Object Lock for compliance.
- **Logging**: Enable AWS CloudTrail for API audit logging. Enable VPC Flow Logs for network monitoring.
- **Secrets**: If adding API keys or tokens, use AWS Secrets Manager with automatic rotation.
- **Access logging**: Configure S3 access logging retention based on compliance requirements (current: 90 days).
- **Monitoring**: Add SNS email subscription to the alert topic. Consider adding AWS Config rules for drift detection.

## Resource Cleanup

To remove all resources deployed by this project:

1. Run `npx cdk destroy --all` from the `infrastructure/` directory
2. S3 buckets will be automatically emptied and deleted (autoDeleteObjects: true)
3. KMS keys will be scheduled for deletion (30-day waiting period)
4. Verify in AWS Console that no orphaned resources remain

## Dependencies

| Dependency | Version | Notes |
|------------|---------|-------|
| aws-cdk-lib | ^2.x | AWS CDK framework — no known vulnerabilities |
| langchain-aws | >=0.2.14 | LangChain AWS integration |
| langchain-core | >=0.3.0 | LangChain core framework |
| boto3 | >=1.34.0 | AWS SDK for Python |
| mcp | >=1.0.0 | Model Context Protocol SDK |
| pydantic | >=2.0.0 | Input validation |
| python-dotenv | >=1.0.0 | Environment variable loading |