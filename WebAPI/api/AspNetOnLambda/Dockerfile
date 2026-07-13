# Build stage
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /source

COPY *.sln .
COPY YourWebApi/*.csproj ./YourWebApi/
RUN dotnet restore

COPY YourWebApi/. ./YourWebApi/
WORKDIR /source/YourWebApi
RUN dotnet publish -c Release -o /app --no-restore

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
ENTRYPOINT ["dotnet", "YourWebApi.dll"]