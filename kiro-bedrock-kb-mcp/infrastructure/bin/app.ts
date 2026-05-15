#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { BedrockKnowledgeBaseStack } from "../lib/bedrock-kb-stack";
import { MonitoringStack } from "../lib/monitoring-stack";

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
};

const kbStack = new BedrockKnowledgeBaseStack(app, "KiroBedrockKBStack", {
  env,
  description:
    "Bedrock Knowledge Base with S3 data source for Kiro CLI MCP integration",
});

new MonitoringStack(app, "KiroBedrockKBMonitoringStack", {
  env,
  description: "CloudWatch dashboard and alarms for Kiro KB MCP integration",
  knowledgeBaseId: kbStack.knowledgeBaseId,
});
