package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
)

func main() {
	lambda.Start(handler)
}

func handler(ctx context.Context) error {

	log.Println("Hello World from Database Setup")

	log.Println("Acquiring username and password")

	username, password, err := getDBUsernameAndPassword(ctx)
	if err != nil {
		return err
	}

	log.Printf("Username: '%s' Password: '%s'", *username, *password)

	return nil
}

func getDBUsernameAndPassword(ctx context.Context) (*string, *string, error) {
	databaseSecretEnvVar := "DATABASE_SECRET_NAME"

	secretName, exists := os.LookupEnv(databaseSecretEnvVar)
	if !exists {
		return nil, nil, fmt.Errorf("environment variable %s not set", databaseSecretEnvVar)
	}

	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to load AWS config: %w", err)
	}

	secretClient := secretsmanager.NewFromConfig(cfg)

	result, err := secretClient.GetSecretValue(ctx, &secretsmanager.GetSecretValueInput{
		SecretId: &secretName,
	})

	var secretMap map[string]interface{}
	if err := json.Unmarshal([]byte(*result.SecretString), &secretMap); err != nil {
		return nil, nil, fmt.Errorf("failed to unmarshal secret string: %v", err)
	}

	userNameFieldName := "username"
	passwordFieldName := "password"
	failureErrorString := "failed to acquire '%s' from secret string: field not present"

	username, exists := secretMap[userNameFieldName].(string)
	if !exists {
		return nil, nil, fmt.Errorf(failureErrorString, userNameFieldName)
	}

	password, exists := secretMap[passwordFieldName].(string)
	if !exists {
		return nil, nil, fmt.Errorf(failureErrorString, passwordFieldName)
	}

	return &username, &password, nil
}
