FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0 AS build

#ARG CACHE_BUST=1

WORKDIR /src
ARG TARGETARCH
COPY ["Api.csproj", "."]
RUN dotnet restore -a $TARGETARCH
COPY . .
RUN dotnet publish "./Api.csproj" -a $TARGETARCH --no-restore -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
EXPOSE 8080

COPY --from=build /app/publish .

ENTRYPOINT ["./Api"]