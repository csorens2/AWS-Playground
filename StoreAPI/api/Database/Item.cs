
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;

namespace Api.Database;

[PrimaryKey(nameof(Name))]
public class Item
{
    public string Name { get; set; }

    public double Price { get; set; }
}