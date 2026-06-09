FROM golang:1.26.2 AS build
WORKDIR /database-setup

COPY go.mod go.sum ./
COPY main.go ./

RUN go build -tags lambda.norpc -o main main.go

FROM public.ecr.aws/lambda/provided:al2023
COPY --from=build /database-setup/main ./main
ENTRYPOINT [ "./main" ]