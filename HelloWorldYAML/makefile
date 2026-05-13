AWS_PROFILE ?= default
AWS_REGION  ?= us-east-1
AWS_OUTPUT  ?= json

deploy-my-first-stack:
	aws cloudformation deploy \
		--template-file Projects\MyFirstCloudformationStack\my-first-stack.yaml \
		--stack-name my-first-stack