
using Api.Database;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

class API
{
    static void Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);

        // Add services to the container.

        var endpoint = Environment.GetEnvironmentVariable("databaseURL");
        var databaseName = Environment.GetEnvironmentVariable("databaseName");
        var userName = Environment.GetEnvironmentVariable("user");
        var password = Environment.GetEnvironmentVariable("databasePassword");

        var connectionString = $"Server={endpoint};Port=3306;Database={databaseName};User={userName};Password={password};";

        builder.Services.AddControllers();
        // Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
        builder.Services.AddOpenApi();
        builder.Services.AddDbContext<ApiDbContext>(options =>
        {
            options.UseMySql(
                connectionString,
                ServerVersion.AutoDetect(connectionString));
        });

        var app = builder.Build();

        using (var scope = app.Services.CreateScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<ApiDbContext>();
            dbContext.Database.EnsureCreated();   // ← the method you asked for
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

