using Api.Database;
using Microsoft.AspNetCore.Mvc;

namespace Api.Controllers;

public record NewItemRequest()
{
    required public string ItemName { get; set; }
    required public double ItemCost { get; set; }
}

[ApiController]
[Route("[controller]")]
public class VendorController : ControllerBase
{
    private readonly ApiDbContext _context;

    public VendorController(ApiDbContext dbContext)
    {
        _context = dbContext;
    }

    [HttpGet]
    public ActionResult RootGet()
    {
        Console.WriteLine("Hello World from Root Get");

        _context.Add(new Item { Name = "Hello", Price = 20.11 });
        _context.SaveChanges();

        return Ok();
    }
    
    [HttpPost("NewItem")]
    public ActionResult PostNewItem([FromBody] NewItemRequest request)
    {
        _context.Add(new Item { Name = request.ItemName, Price = request.ItemCost });
        _context.SaveChanges();

        return Ok();
    }
}