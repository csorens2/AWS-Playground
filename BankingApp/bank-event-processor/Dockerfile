FROM golang:1.26.2 AS build
WORKDIR /bank-event-processor

COPY go.mod go.sum ./
COPY main.go ./

RUN go build -tags lambda.norpc -o main main.go

FROM public.ecr.aws/lambda/provided:al2023
COPY --from=build /bank-event-processor/main ./main
ENTRYPOINT [ "./main" ]