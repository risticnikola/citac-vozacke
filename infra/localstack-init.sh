#!/bin/bash
set -e

AWS="aws --endpoint-url=http://localhost:4566 --region eu-west-1"

echo "Creating S3 buckets..."
$AWS s3 mb s3://vehicle-dumps   || true
$AWS s3 mb s3://vehicle-reports || true

echo "Creating SQS queues..."
$AWS sqs create-queue --queue-name dead-letter \
  --attributes '{"MessageRetentionPeriod":"1209600"}'

DEAD_LETTER_ARN=$($AWS sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/dead-letter \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' --output text)

REDRIVE='{"deadLetterTargetArn":"'"$DEAD_LETTER_ARN"'","maxReceiveCount":"5"}'

$AWS sqs create-queue --queue-name card-reads \
  --attributes "{\"RedrivePolicy\":$(echo $REDRIVE | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}"

$AWS sqs create-queue --queue-name billing-events \
  --attributes "{\"RedrivePolicy\":$(echo $REDRIVE | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}"

$AWS sqs create-queue --queue-name reports \
  --attributes "{\"RedrivePolicy\":$(echo $REDRIVE | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}"

echo "LocalStack init complete."
