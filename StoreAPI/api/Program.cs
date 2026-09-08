
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.DataModel;
using Amazon.S3;
using Api.Database;
using Microsoft.AspNetCore.HttpLogging;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using System.Runtime;

class API
{
    static void Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);

        // Add services to the container.
        builder.Services.AddControllers();
        // Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
        builder.Services.AddOpenApi();
        builder.Services.AddDbContext<ApiDbContext>(options =>
        {
            var itemsDatabaseEndpoint = Environment.GetEnvironmentVariable("itemsDatabaseEndpoint");
            var itemsDatabaseName = Environment.GetEnvironmentVariable("itemsDatabaseName");
            var itemsDatabaseUser = Environment.GetEnvironmentVariable("itemsDatabaseUser");
            var itemsDatabasePassword = Environment.GetEnvironmentVariable("itemsDatabasePassword");
            var itemsDatabaseConnectionString = $"Server={itemsDatabaseEndpoint};Port=3306;Database={itemsDatabaseName};User={itemsDatabaseUser};Password={itemsDatabasePassword};";

            options.UseMySql(
                itemsDatabaseConnectionString,
                ServerVersion.AutoDetect(itemsDatabaseConnectionString));
        });
        builder.Services.Configure<ControllerSettings>(options =>
        {
            options.ItemPicturesBucketName = Environment.GetEnvironmentVariable("itemPicturesBucketName")!;
            options.Region = Environment.GetEnvironmentVariable("region")!;
            options.UserPoolId = Environment.GetEnvironmentVariable("userPoolId")!;
        });

        builder.Services.AddHttpLogging(options =>
        {
            options.LoggingFields = HttpLoggingFields.All;
        });

        builder.Services.AddAWSService<IAmazonS3>();

        builder.Services.AddDefaultAWSOptions(builder.Configuration.GetAWSOptions());
        builder.Services.AddAWSService<IAmazonDynamoDB>();
        builder.Services.Configure<DynamoDbOptions>(
            builder.Configuration.GetSection("DynamoDb"));
        builder.Services.AddSingleton<IDynamoDBContext>(serviceProvider =>
        {
            var client = serviceProvider.GetRequiredService<IAmazonDynamoDB>();

            return
                new DynamoDBContextBuilder()
                    .WithDynamoDBClient(() => client)
                    .ConfigureContext(cfg =>
                    {
                        cfg.DisableFetchingTableMetadata = true;
                    })
                    .Build();
        });

        var app = builder.Build();

        app.UseHttpLogging();

        app.Use(async (context, next) =>
        {
            Console.WriteLine($"[{DateTime.UtcNow:O}] {context.Request.Method} {context.Request.Path} Content-Type: {context.Request.ContentType}");
            await next();
        });

        using (var scope = app.Services.CreateScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<ApiDbContext>();
            dbContext.Database.EnsureCreated();
        }

        // Configure the HTTP request pipeline.
        if (app.Environment.IsDevelopment())
        {
            app.MapOpenApi();
        }

        app.UseHttpsRedirection();

        app.UseAuthorization();

        app.MapControllers();

        app.Run();
    }
}

