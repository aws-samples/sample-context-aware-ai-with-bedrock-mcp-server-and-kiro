import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as sns from "aws-cdk-lib/aws-sns";
import * as kms from "aws-cdk-lib/aws-kms";
import * as cw_actions from "aws-cdk-lib/aws-cloudwatch-actions";
import { Construct } from "constructs";

interface MonitoringStackProps extends cdk.StackProps {
  knowledgeBaseId: string;
}

/**
 * CloudWatch dashboard and alarms for monitoring the
 * Bedrock Knowledge Base + MCP server integration.
 *
 * Includes productivity measurement widgets that track how
 * developers use the KB to reduce context-switching.
 */
export class MonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    // ASH/cdk-nag: AwsSolutions-SNS2 — SNS topic should be encrypted
    const snsKey = new kms.Key(this, "SNSEncryptionKey", {
      description: "KMS key for Kiro KB alert SNS topic encryption",
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Allow CloudWatch Alarms to publish to the encrypted topic
    snsKey.addToResourcePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        principals: [
          new cdk.aws_iam.ServicePrincipal("cloudwatch.amazonaws.com"),
        ],
        actions: ["kms:Decrypt", "kms:GenerateDataKey*"],
        resources: ["*"],
      })
    );

    const alertTopic = new sns.Topic(this, "AlertTopic", {
      topicName: "kiro-kb-alerts",
      displayName: "Kiro KB Integration Alerts",
      masterKey: snsKey,
    });

    // ---------------------------------------------------------------
    // Operational metrics (emitted by MCP server)
    // ---------------------------------------------------------------
    const retrievalLatency = new cloudwatch.Metric({
      namespace: "Kiro/BedrockKB",
      metricName: "RetrievalLatency",
      statistic: "p99",
      period: cdk.Duration.minutes(5),
    });

    const retrievalErrors = new cloudwatch.Metric({
      namespace: "Kiro/BedrockKB",
      metricName: "RetrievalErrors",
      statistic: "Sum",
      period: cdk.Duration.minutes(5),
    });

    const queryCount = new cloudwatch.Metric({
      namespace: "Kiro/BedrockKB",
      metricName: "QueryCount",
      statistic: "Sum",
      period: cdk.Duration.minutes(5),
    });

    const emptyResults = new cloudwatch.Metric({
      namespace: "Kiro/BedrockKB",
      metricName: "EmptyResults",
      statistic: "Sum",
      period: cdk.Duration.minutes(5),
    });

    // ---------------------------------------------------------------
    // Productivity metrics
    // ---------------------------------------------------------------
    const productivityRetrieve = new cloudwatch.Metric({
      namespace: "Kiro/BedrockKB",
      metricName: "ProductivityQueries",
      dimensionsMap: { QueryType: "retrieve" },
      statistic: "Sum",
      period: cdk.Duration.hours(1),
    });

    const productivityAsk = new cloudwatch.Metric({
      namespace: "Kiro/BedrockKB",
      metricName: "ProductivityQueries",
      dimensionsMap: { QueryType: "ask" },
      statistic: "Sum",
      period: cdk.Duration.hours(1),
    });

    // Estimated time saved: each successful KB query saves ~5 min
    // of context-switching (searching docs, Slack, wikis).
    // This is a math expression metric for the dashboard.
    const estimatedTimeSavedMinutes = new cloudwatch.MathExpression({
      expression: "queries * 5",
      usingMetrics: {
        queries: queryCount.with({
          statistic: "Sum",
          period: cdk.Duration.days(1),
        }),
      },
      label: "Estimated Minutes Saved (24h)",
      period: cdk.Duration.days(1),
    });

    // ---------------------------------------------------------------
    // Alarms
    // ---------------------------------------------------------------
    const latencyAlarm = new cloudwatch.Alarm(this, "HighLatencyAlarm", {
      metric: retrievalLatency,
      threshold: 5000,
      evaluationPeriods: 3,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription:
        "Knowledge base retrieval P99 latency exceeds 5 seconds",
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    latencyAlarm.addAlarmAction(new cw_actions.SnsAction(alertTopic));

    const errorAlarm = new cloudwatch.Alarm(this, "HighErrorRateAlarm", {
      metric: retrievalErrors,
      threshold: 10,
      evaluationPeriods: 2,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription:
        "More than 10 retrieval errors in 5 minutes",
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    errorAlarm.addAlarmAction(new cw_actions.SnsAction(alertTopic));

    // ---------------------------------------------------------------
    // Dashboard
    // ---------------------------------------------------------------
    new cloudwatch.Dashboard(this, "KiroKBDashboard", {
      dashboardName: "Kiro-BedrockKB-Integration",
      widgets: [
        // Row 1: Operational overview
        [
          new cloudwatch.GraphWidget({
            title: "Query Volume",
            left: [queryCount],
            width: 12,
          }),
          new cloudwatch.GraphWidget({
            title: "Retrieval Latency (P99)",
            left: [retrievalLatency],
            width: 12,
          }),
        ],
        // Row 2: Errors and empty results
        [
          new cloudwatch.GraphWidget({
            title: "Errors",
            left: [retrievalErrors],
            width: 12,
          }),
          new cloudwatch.GraphWidget({
            title: "Empty Results (no matches)",
            left: [emptyResults],
            width: 12,
          }),
        ],
        // Row 3: Productivity measurement
        [
          new cloudwatch.GraphWidget({
            title: "Productivity — Queries by Type (hourly)",
            left: [productivityRetrieve, productivityAsk],
            width: 12,
          }),
          new cloudwatch.SingleValueWidget({
            title: "Estimated Time Saved (24h)",
            metrics: [estimatedTimeSavedMinutes],
            width: 6,
          }),
          new cloudwatch.SingleValueWidget({
            title: "Total Queries (24h)",
            metrics: [
              queryCount.with({ period: cdk.Duration.days(1) }),
            ],
            width: 6,
          }),
        ],
        // Row 4: Summary and alarms
        [
          new cloudwatch.SingleValueWidget({
            title: "Error Count (24h)",
            metrics: [
              retrievalErrors.with({ period: cdk.Duration.days(1) }),
            ],
            width: 6,
          }),
          new cloudwatch.SingleValueWidget({
            title: "Empty Result Rate (24h)",
            metrics: [
              emptyResults.with({ period: cdk.Duration.days(1) }),
            ],
            width: 6,
          }),
          new cloudwatch.AlarmStatusWidget({
            title: "Alarm Status",
            alarms: [latencyAlarm, errorAlarm],
            width: 12,
          }),
        ],
      ],
    });

    // ---------------------------------------------------------------
    // Outputs
    // ---------------------------------------------------------------
    new cdk.CfnOutput(this, "DashboardURL", {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=Kiro-BedrockKB-Integration`,
      description: "CloudWatch Dashboard URL",
    });

    new cdk.CfnOutput(this, "AlertTopicArn", {
      value: alertTopic.topicArn,
      description: "SNS topic for alerts — subscribe your email",
    });
  }
}