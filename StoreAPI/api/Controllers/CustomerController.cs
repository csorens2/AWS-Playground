namespace Api.Controllers;

using Microsoft.AspNetCore.Mvc;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.DataModel;
using Microsoft.Extensions.Options;

[ApiController]
[Route("[controller]")]
public class CustomerController : ControllerBase
{
    private readonly IDynamoDBContext _context;
    private readonly DynamoDBOperationConfig _opConfig;
    private readonly SaveConfig _saveConfig;

    public CustomerController(IDynamoDBContext dbContext, IOptions<DynamoDbOptions> options)
    {
        Console.WriteLine($"Testing 1234 {options.Value.CartTableName}");
        _context = dbContext;

        var test = new SaveConfig
        {
            OverrideTableName = options.Value.CartTableName
        };
        _saveConfig = test;


        _opConfig = new DynamoDBOperationConfig
        {
            OverrideTableName = options.Value.CartTableName
        };
    }

    [HttpGet]
    public async Task<IActionResult> RootGet()
    {
        Console.WriteLine("Hello World from Root Get of Customer");

        await _context.SaveAsync(new Cart { CartGuid = Guid.NewGuid().ToString(), }, _saveConfig);

        return Ok();
    }
}