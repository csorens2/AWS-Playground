
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

public class LoginTokenValidator
{

    public static async Task<bool> VerifyJWTAsync(string jwt, string region, string userPoolId)
    {
        using var httpClient = new HttpClient();
        var jwksUrl = $"https://cognito-idp.{region}.amazonaws.com/{userPoolId}/.well-known/jwks.json";
        string jwksJson = await httpClient.GetStringAsync(jwksUrl);
        var jwks = new JsonWebKeySet(jwksJson);

        var parameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKeys = jwks.GetSigningKeys(),
            RequireSignedTokens = true,

            ValidateIssuer = true,
            ValidIssuer = $"https://cognito-idp.{region}.amazonaws.com/{userPoolId}",

            ValidateAudience = false,

            ValidateLifetime = true,
            RequireExpirationTime = true,
            ClockSkew = TimeSpan.FromMinutes(2)
        };

        var handler = new JsonWebTokenHandler();
        TokenValidationResult result = await handler.ValidateTokenAsync(jwt, parameters);

        if (!result.IsValid)
        {
            Console.WriteLine($"Invalid JWT: {result.Exception?.Message}");
            return false;
        }

        return true;
    }

    public static List<string> GetCognitoGroups(string jwt)
    {
        var handler = new JsonWebTokenHandler();
        JsonWebToken token = handler.ReadJsonWebToken(jwt);

        string[] cognitoGroups;
        var hasGroups = token.TryGetPayloadValue("cognito:groups", out cognitoGroups);
        if (!hasGroups)
        {
            Console.WriteLine("No cognito groups found");
        }

        return cognitoGroups.ToList();
    }


}