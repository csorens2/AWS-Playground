

using Amazon.DynamoDBv2.DataModel;

public class Cart
{
    [DynamoDBHashKey]
    public string CartGuid { get; set; }
}