package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/rds/auth"
	_ "github.com/go-sql-driver/mysql"
)

func testingHandler(ctx context.Context, event json.RawMessage) error {
	log.Println("Hello World from the Lambda!")

	proxyEndpoint := os.Getenv("PROXY_ENDPOINT")
	port := 3306
	databaseName := os.Getenv("DATABASE_NAME")
	databaseUser := os.Getenv("DATABASE_USER")

	if proxyEndpoint == "" || databaseName == "" || databaseUser == "" {
		return fmt.Errorf("missing required environment variables")
	}

	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return fmt.Errorf("failed to load AWS config: %w", err)
	}

	dbEndpoint := fmt.Sprintf("%s:%d", proxyEndpoint, port)

	token, err := auth.BuildAuthToken(
		ctx,
		dbEndpoint,
		cfg.Region,
		databaseUser,
		cfg.Credentials)
	if err != nil {
		return fmt.Errorf("failed to generate auth token: %w", err)
	}

	dsn := fmt.Sprintf("%s:%s@tcp(%s)/%s?tls=true&allowCleartextPasswords=true&authPlugin=mysql_native_password",
		databaseUser, token, dbEndpoint, databaseName)

	//"%s:%s@tcp(%s)/%s?tls=true&allowCleartextPasswords=true&authPlugin=mysql_native_password"

	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return fmt.Errorf("failed to open DB connection: %w", err)
	}
	defer db.Close()

	conn, err := net.DialTimeout("tcp", proxyEndpoint+":3306", 5*time.Second)
	if err != nil {
		log.Printf("TCP dial test failed: %v", err)
	}
	if conn != nil {
		conn.Close()
		log.Println("TCP dial to proxy:3306 succeeded")
	}

	if err := db.PingContext(ctx); err != nil {
		log.Printf("Ping failed. Error type: %T", err)
		log.Printf("Ping error: %+v", err) // %+v often gives more context
		log.Printf("Ping error string: %s", err.Error())

		// Optional: unwrap for wrapped errors
		if unwrapped := errors.Unwrap(err); unwrapped != nil {
			log.Printf("Unwrapped error: %+v", unwrapped)
		}

		return fmt.Errorf("failed to ping RDS Proxy: %w", err)
	}

	return nil
}

func main() {
	lambda.Start(testingHandler)
}
