using Microsoft.AspNetCore.Mvc;

namespace WebAPI
{
    [ApiController]
    [Route("api/[controller")]
    public class HelloWorldController: ControllerBase
    {
        [HttpGet]
        public IActionResult Get()
        {
            return Ok(new
            {
                Message = "Hello World from HTTPGet",
                Timestamp = DateTime.Now
            });
        }
    }
}
