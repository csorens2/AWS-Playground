using Amazon.S3;
using Amazon.S3.Model;
using Api.Database;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Api.Controllers;

public record NewItemRequest()
{
    required public string ItemName { get; set; }
    required public double ItemCost { get; set; }

    required public IFormFile ItemPicture { get; set; }
}

[ApiController]
[Route("[controller]")]
public class VendorController : ControllerBase
{
    private readonly ApiDbContext _context;

    private readonly ControllerSettings _settings;

    private readonly IAmazonS3 _s3Client;

    public VendorController(ApiDbContext dbContext, IOptions<ControllerSettings> settings, IAmazonS3 s3Client)
    {
        _context = dbContext;
        _settings = settings.Value;
        _s3Client = s3Client;
    }

    [HttpGet]
    public IActionResult RootGet()
    {
        Console.WriteLine("Hello World from Root Get");

        _context.Add(new Item { Name = "Hello", Price = 20.11 });
        _context.SaveChanges();

        return Ok();
    }
    
    [HttpPost("NewItem")]
    [RequestSizeLimit(10_000_000)]
    public async Task<IActionResult> PostNewItem([FromForm] NewItemRequest request)
    {
        Console.WriteLine("Hello World from PostNewItem");

        var file = request.ItemPicture;

        if (file == null || file.Length == 0)
        {
            return BadRequest("No file uploaded.");
        }

        string itemKey = $"uploads/{Guid.NewGuid()}_{file.FileName}";
        using var stream = file.OpenReadStream();
        var putObjectRequest = new PutObjectRequest
        {
            BucketName = _settings.ItemPicturesBucketName,
            Key = itemKey,
            InputStream = stream,
        };
        await _s3Client.PutObjectAsync(putObjectRequest);


        _context.Add(new Item { Name = request.ItemName, Price = request.ItemCost });
        _context.SaveChanges();

        return Ok();
    }
}