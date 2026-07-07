using System;
using System.Collections.Generic;
using System.Text;

using Amazon.Lambda.AspNetCoreServer;
using Microsoft.AspNetCore.Hosting;

namespace WebAPI
{
    public class LambdaEntryPoint: APIGatewayProxyFunction
    {
        protected override void Init(IWebHostBuilder builder)
        {
            base.Init(builder);
        }
    }
}
