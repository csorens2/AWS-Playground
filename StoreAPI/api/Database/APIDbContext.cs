using Microsoft.EntityFrameworkCore;

namespace Api.Database;

public class ApiDbContext : DbContext
{
    public DbSet<Item> ItemSet { get; set; }

    public ApiDbContext(DbContextOptions<ApiDbContext> options)
        : base(options)
    {
        
    }
}