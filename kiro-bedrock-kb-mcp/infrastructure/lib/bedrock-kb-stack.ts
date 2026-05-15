import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as cr from "aws-cdk-lib/custom-resources";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as bedrock from "aws-cdk-lib/aws-bedrock";
import * as path from "path";
import { Construct } from "constructs";

export class BedrockKnowledgeBaseStack extends cdk.Stack {
  public readonly knowledgeBaseId: string;
  public readonly dataSourceId: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const collectionName = "kiro-kb-vectors";
    const indexName = "kiro-kb-index";

    // ---------------------------------------------------------------
    // VPC for OpenSearch Serverless VPC endpoint
    // ---------------------------------------------------------------
    const vpc = new ec2.Vpc(this, "KiroKBVpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    const aossSecurityGroup = new ec2.SecurityGroup(this, "AOSSSecurityGroup", {
      vpc,
      description: "Security group for OpenSearch Serverless VPC endpoint",
      allowAllOutbound: false,
    });

    aossSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(443),
      "Allow HTTPS from VPC"
    );

    const aossVpcEndpoint =
      new cdk.aws_opensearchserverless.CfnVpcEndpoint(this, "AOSSVpcEndpoint", {
        name: "kiro-kb-vpce",
        vpcId: vpc.vpcId,
        subnetIds: vpc.selectSubnets({
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        }).subnetIds,
        securityGroupIds: [aossSecurityGroup.securityGroupId],
      });

    // ---------------------------------------------------------------
    // S3 access logging bucket
    // ---------------------------------------------------------------
    const accessLogsBucket = new s3.Bucket(this, "AccessLogsBucket", {
      bucketName: `kiro-kb-access-logs-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [
        { expiration: cdk.Duration.days(90), id: "ExpireAccessLogs" },
      ],
    });

    // ---------------------------------------------------------------
    // S3 bucket for knowledge base documents
    // ---------------------------------------------------------------
    const docsBucket = new s3.Bucket(this, "KBDocsBucket", {
      bucketName: `kiro-kb-docs-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: "kb-docs-bucket/",
    });

    new s3deploy.BucketDeployment(this, "DeployKBDocs", {
      sources: [s3deploy.Source.asset("../sample-knowledge-base")],
      destinationBucket: docsBucket,
      destinationKeyPrefix: "documents/",
    });

    // ---------------------------------------------------------------
    // IAM roles
    // ---------------------------------------------------------------
    const kbRole = new iam.Role(this, "BedrockKBRole", {
      assumedBy: new iam.ServicePrincipal("bedrock.amazonaws.com"),
      description:
        "Role for Bedrock Knowledge Base to access S3 and embeddings",
    });

    docsBucket.grantRead(kbRole);

    kbRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["bedrock:InvokeModel"],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
        ],
      })
    );

    kbRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["aoss:APIAccessAll"],
        // Scoped to this account/region. Cannot use collection name in ARN —
        // the resource ARN requires the generated collection ID which is only
        // known after creation. collection/* prevents cross-account access.
        resources: [`arn:aws:aoss:${this.region}:${this.account}:collection/*`],
      })
    );

    const mcpServerRole = new iam.Role(this, "MCPServerRole", {
      assumedBy: new iam.AccountPrincipal(this.account),
      description:
        "Role assumed by MCP server to query Bedrock Knowledge Base",
      maxSessionDuration: cdk.Duration.hours(1),
    });

    // ---------------------------------------------------------------
    // OpenSearch Serverless collection + policies
    // ---------------------------------------------------------------
    const encryptionPolicy =
      new cdk.aws_opensearchserverless.CfnSecurityPolicy(
        this, "EncryptionPolicy", {
          name: "kiro-kb-enc-policy",
          type: "encryption",
          policy: JSON.stringify({
            Rules: [{
              ResourceType: "collection",
              Resource: [`collection/${collectionName}`],
            }],
            AWSOwnedKey: true,
          }),
        }
      );

    const networkPolicy =
      new cdk.aws_opensearchserverless.CfnSecurityPolicy(
        this, "NetworkPolicy", {
          name: "kiro-kb-net-policy",
          type: "network",
          policy: JSON.stringify([{
            Rules: [{
              ResourceType: "collection",
              Resource: [`collection/${collectionName}`],
            }],
            AllowFromPublic: true,
          }]),
        }
      );

    // The Lambda that creates the index also needs access
    const indexCreatorRole = new iam.Role(this, "IndexCreatorRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole"
        ),
      ],
    });

    indexCreatorRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["aoss:APIAccessAll"],
        // Scoped to this account/region. Cannot use collection name in ARN —
        // the resource ARN requires the generated collection ID which is only
        // known after creation. collection/* prevents cross-account access.
        resources: [`arn:aws:aoss:${this.region}:${this.account}:collection/*`],
      })
    );

    indexCreatorRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["aoss:BatchGetCollection"],
        resources: ["*"],
      })
    );

    const dataAccessPolicy =
      new cdk.aws_opensearchserverless.CfnAccessPolicy(
        this, "DataAccessPolicy", {
          name: "kiro-kb-data-policy",
          type: "data",
          policy: cdk.Fn.sub(
            JSON.stringify([{
              Rules: [
                {
                  ResourceType: "index",
                  Resource: [`index/${collectionName}/*`],
                  Permission: [
                    "aoss:CreateIndex",
                    "aoss:UpdateIndex",
                    "aoss:DescribeIndex",
                    "aoss:ReadDocument",
                    "aoss:WriteDocument",
                  ],
                },
                {
                  ResourceType: "collection",
                  Resource: [`collection/${collectionName}`],
                  Permission: [
                    "aoss:CreateCollectionItems",
                    "aoss:DescribeCollectionItems",
                    "aoss:UpdateCollectionItems",
                  ],
                },
              ],
              Principal: [
                "${KBRoleArn}",
                "${MCPServerRoleArn}",
                "${IndexCreatorRoleArn}",
              ],
            }]),
            {
              KBRoleArn: kbRole.roleArn,
              MCPServerRoleArn: mcpServerRole.roleArn,
              IndexCreatorRoleArn: indexCreatorRole.roleArn,
            }
          ),
        }
      );

    const collection =
      new cdk.aws_opensearchserverless.CfnCollection(
        this, "VectorCollection", {
          name: collectionName,
          type: "VECTORSEARCH",
          description: "Vector store for Kiro knowledge base embeddings",
        }
      );

    collection.addDependency(encryptionPolicy);
    collection.addDependency(networkPolicy);
    collection.addDependency(dataAccessPolicy);

    // ---------------------------------------------------------------
    // Custom Resource: create the vector index inside the collection.
    // OpenSearch Serverless has no CloudFormation resource for indexes,
    // so a Lambda calls the OpenSearch API to create it.
    // ---------------------------------------------------------------
    // Pre-bundle: run `pip install` into the handler directory before cdk deploy.
    // This avoids needing Docker. The setup script handles this automatically.
    const indexCreatorFn = new lambda.Function(this, "IndexCreatorFn", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "index.on_event",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "aoss-index-handler", "bundle")
      ),
      timeout: cdk.Duration.minutes(14),
      role: indexCreatorRole,
    });

    const indexProvider = new cr.Provider(this, "IndexProvider", {
      onEventHandler: indexCreatorFn,
    });

    const indexResource = new cdk.CustomResource(this, "AOSSIndex", {
      serviceToken: indexProvider.serviceToken,
      properties: {
        CollectionEndpoint: collection.attrCollectionEndpoint,
        CollectionName: collectionName,
        IndexName: indexName,
        EmbeddingDimension: "1024",
      },
    });

    indexResource.node.addDependency(collection);
    indexResource.node.addDependency(dataAccessPolicy);

    // ---------------------------------------------------------------
    // Bedrock Knowledge Base (depends on index existing)
    // ---------------------------------------------------------------
    const knowledgeBase = new bedrock.CfnKnowledgeBase(
      this, "KiroKnowledgeBase", {
        name: "kiro-dev-knowledge-base",
        description:
          "Development knowledge base containing API docs, ADRs, security guidelines, and coding standards",
        roleArn: kbRole.roleArn,
        knowledgeBaseConfiguration: {
          type: "VECTOR",
          vectorKnowledgeBaseConfiguration: {
            embeddingModelArn: `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
          },
        },
        storageConfiguration: {
          type: "OPENSEARCH_SERVERLESS",
          opensearchServerlessConfiguration: {
            collectionArn: collection.attrArn,
            vectorIndexName: indexName,
            fieldMapping: {
              vectorField: "embedding",
              textField: "text",
              metadataField: "metadata",
            },
          },
        },
      }
    );

    // KB must wait for the index to be created
    knowledgeBase.node.addDependency(indexResource);

    cdk.Tags.of(knowledgeBase).add("mcp-multirag-kb", "true");

    // ---------------------------------------------------------------
    // S3 Data Source
    // ---------------------------------------------------------------
    const dataSource = new bedrock.CfnDataSource(this, "KBDataSource", {
      knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
      name: "s3-dev-docs",
      description: "S3 data source containing development documentation",
      dataSourceConfiguration: {
        type: "S3",
        s3Configuration: {
          bucketArn: docsBucket.bucketArn,
          inclusionPrefixes: ["documents/"],
        },
      },
      vectorIngestionConfiguration: {
        chunkingConfiguration: {
          chunkingStrategy: "FIXED_SIZE",
          fixedSizeChunkingConfiguration: {
            maxTokens: 512,
            overlapPercentage: 20,
          },
        },
      },
    });

    this.knowledgeBaseId = knowledgeBase.attrKnowledgeBaseId;
    this.dataSourceId = dataSource.attrDataSourceId;

    // ---------------------------------------------------------------
    // MCP server role policies
    // ---------------------------------------------------------------
    mcpServerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["bedrock:Retrieve", "bedrock:RetrieveAndGenerate"],
        resources: [knowledgeBase.attrKnowledgeBaseArn],
      })
    );

    mcpServerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["bedrock:InvokeModel"],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0`,
          `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-haiku-20240307-v1:0`,
        ],
      })
    );

    mcpServerRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["cloudwatch:PutMetricData"],
        resources: ["*"],
        conditions: {
          StringEquals: { "cloudwatch:namespace": "Kiro/BedrockKB" },
        },
      })
    );

    // ---------------------------------------------------------------
    // Outputs
    // ---------------------------------------------------------------
    new cdk.CfnOutput(this, "KnowledgeBaseId", {
      value: knowledgeBase.attrKnowledgeBaseId,
      description: "Bedrock Knowledge Base ID",
      exportName: "KiroKBId",
    });
    new cdk.CfnOutput(this, "DataSourceId", {
      value: dataSource.attrDataSourceId,
      description: "Knowledge Base Data Source ID",
    });
    new cdk.CfnOutput(this, "DocsBucketName", {
      value: docsBucket.bucketName,
      description: "S3 bucket for knowledge base documents",
    });
    new cdk.CfnOutput(this, "MCPServerRoleArn", {
      value: mcpServerRole.roleArn,
      description: "IAM role ARN for MCP server",
      exportName: "KiroMCPServerRoleArn",
    });
    new cdk.CfnOutput(this, "VpcEndpointId", {
      value: aossVpcEndpoint.attrId,
      description: "OpenSearch Serverless VPC endpoint ID",
    });
  }
}