-- Recovery SQL: Kickstart Bundle Box 2
-- Sold: 2026-03-17 | Sale: $5,758.00 | Shipping: $248.37 | Items: 215 | Profit: $1,151.00
-- Source: Kickstart Free People Pallet #1.pdf
-- Cost: $21.43 x 214 items + $20.98 x 1 item (row 215) = $4,607.00 exactly

WITH intake_inserts AS (
  INSERT INTO kickstart_intake (brand, description, color, size, msrp, cost, status)
  VALUES
    -- Row 1
    ('Free People', 'FP Movement Billie Boxy Lightweight Insulated Jacket', 'Tan', 'L', 248.00, 21.43, 'enriched'),
    -- Row 2
    ('Free People', 'FP Movement Billie Boxy Lightweight Insulated Jacket', 'Tan', 'L', 248.00, 21.43, 'enriched'),
    -- Row 3
    ('Free People', 'FP Movement Billie Boxy Lightweight Insulated Jacket', 'Tan', 'L', 248.00, 21.43, 'enriched'),
    -- Row 4
    ('Free People', 'FP Movement Billie Boxy Lightweight Insulated Jacket', 'Tan', 'L', 248.00, 21.43, 'enriched'),
    -- Row 5
    ('Free People', 'FP Movement Billie Boxy Lightweight Insulated Jacket', 'Tan', 'L', 248.00, 21.43, 'enriched'),
    -- Row 6
    ('Free People', 'FP Movement NWT - Billie Boxie Lightweight Insulated Jacket', 'Purple', 'L', 248.00, 21.43, 'enriched'),
    -- Row 7
    ('Free People', 'FP Movement NWT - Billie Boxie Lightweight Insulated Jacket', 'Purple', 'L', 248.00, 21.43, 'enriched'),
    -- Row 8
    ('Free People', 'FP Movement NWT - Billie Boxie Lightweight Insulated Jacket', 'Purple', 'L', 248.00, 21.43, 'enriched'),
    -- Row 9
    ('Free People', 'FP Movement NWT - Billie Boxie Lightweight Insulated Jacket', 'Purple', 'L', 248.00, 21.43, 'enriched'),
    -- Row 10
    ('Free People', 'FP Movement NWT - Billie Boxie Lightweight Insulated Jacket', 'Purple', 'L', 248.00, 21.43, 'enriched'),
    -- Row 11
    ('Free People', 'FP Movement Tricked Out Trek Lightweight Puffer Jacket', 'Black', 'XS', 368.00, 21.43, 'enriched'),
    -- Row 12
    ('Free People', 'FP Movement Tricked Out Trek Lightweight Puffer Jacket', 'Black', 'XS', 368.00, 21.43, 'enriched'),
    -- Row 13 (blank description in PDF)
    ('Free People', 'Free People Item', 'Navy/Black Combo', 'M', 298.00, 21.43, 'enriched'),
    -- Row 14
    ('Free People', 'FP Movement Moon Magic Rain Parka', 'Dark Blue', 'S', 298.00, 21.43, 'enriched'),
    -- Row 15
    ('Free People', 'FP Movement Moon Magic Rain Parka', 'Dark Blue', 'S', 298.00, 21.43, 'enriched'),
    -- Row 16
    ('Free People', 'We The Free Zandi Woven Quilted Boxy Cropped Jacket', 'Stripe', 'M', 198.00, 21.43, 'enriched'),
    -- Row 17
    ('Free People', 'We The Free Zandi Woven Quilted Boxy Cropped Jacket', 'Stripe', 'M', 198.00, 21.43, 'enriched'),
    -- Row 18
    ('Free People', 'We The Free Jojo Washed Oversized Funnel-Neck Jacket', 'Green', 'S', 198.00, 21.43, 'enriched'),
    -- Row 19
    ('Free People', 'We The Free Jojo Washed Oversized Funnel-Neck Jacket', 'Green', 'S', 198.00, 21.43, 'enriched'),
    -- Row 20
    ('Free People', 'Mountain High Half-Zip Fleece', 'Light Blue', 'S', 98.00, 21.43, 'enriched'),
    -- Row 21
    ('Free People', 'Mountain High Half-Zip Fleece', 'Light Blue', 'S', 98.00, 21.43, 'enriched'),
    -- Row 22
    ('Free People', 'Free People Prairie Field Top', 'Ivory / Cream', 'S', 98.00, 21.43, 'enriched'),
    -- Row 23
    ('Free People', 'Free People Prairie Field Top', 'Ivory / Cream', 'S', 98.00, 21.43, 'enriched'),
    -- Row 24
    ('Free People', 'Free People Prairie Field Top', 'Ivory / Cream', 'S', 98.00, 21.43, 'enriched'),
    -- Row 25
    ('Free People', 'Free People Prairie Field Top', 'Ivory / Cream', 'S', 98.00, 21.43, 'enriched'),
    -- Row 26
    ('Free People', 'Free People Prairie Field Top', 'Ivory / Cream', 'S', 98.00, 21.43, 'enriched'),
    -- Row 27
    ('Free People', 'Free People Prairie Field Top In Black Coffee Combo', 'Brown', 'XS', 98.00, 21.43, 'enriched'),
    -- Row 28
    ('Free People', 'Free People Prairie Field Top In Black Coffee Combo', 'Brown', 'XS', 98.00, 21.43, 'enriched'),
    -- Row 29
    ('Free People', 'Free People Prairie Field Top In Black Coffee Combo', 'Brown', 'XS', 98.00, 21.43, 'enriched'),
    -- Row 30
    ('Free People', 'Free People Prairie Field Top In Black Coffee Combo', 'Brown', 'XS', 98.00, 21.43, 'enriched'),
    -- Row 31
    ('Free People', 'Free People Prairie Field Top In Black Coffee Combo', 'Brown', 'XS', 98.00, 21.43, 'enriched'),
    -- Row 32
    ('Free People', 'Savino Maxi Skirt Set - Top Only', 'Brown', 'XS', 84.00, 21.43, 'enriched'),
    -- Row 33
    ('Free People', 'Free People Bayside Crochet Tunic', 'Red', 'M', 128.00, 21.43, 'enriched'),
    -- Row 34
    ('Free People', 'Free People Bayside Crochet Tunic', 'Red', 'M', 128.00, 21.43, 'enriched'),
    -- Row 35
    ('Free People', 'We The Free Jojo Washed Oversized Funnel-Neck Jacket', 'Black', 'M', 198.00, 21.43, 'enriched'),
    -- Row 36
    ('Free People', 'Free People Boho Chic Crochet Tank', 'Light Blue', 'M', 38.00, 21.43, 'enriched'),
    -- Row 37
    ('Free People', 'Free People Boho Chic Crochet Tank', 'Light Blue', 'M', 38.00, 21.43, 'enriched'),
    -- Row 38
    ('Free People', 'Free People Boho Chic Crochet Tank', 'Light Blue', 'M', 38.00, 21.43, 'enriched'),
    -- Row 39
    ('Free People', 'Free People Bayside Crochet Tunic', 'Red', 'L', 128.00, 21.43, 'enriched'),
    -- Row 40
    ('Free People', 'Free People Alee Blouse Top - White Chocolate Couture', 'White', 'L', 98.00, 21.43, 'enriched'),
    -- Row 41
    ('Free People', 'Free People Alee Blouse Top - White Chocolate Couture', 'White', 'L', 98.00, 21.43, 'enriched'),
    -- Row 42
    ('Free People', 'Free People Alee Blouse Top - White Chocolate Couture', 'White', 'L', 98.00, 21.43, 'enriched'),
    -- Row 43
    ('Free People', 'FP Movement Breeze Blocker Jacket', 'White', 'S', 198.00, 21.43, 'enriched'),
    -- Row 44
    ('Free People', 'FP Movement Breeze Blocker Jacket', 'White', 'S', 198.00, 21.43, 'enriched'),
    -- Row 45
    ('Free People', 'Mountain High Half-Zip Fleece', 'Light Blue', 'XL', 98.00, 21.43, 'enriched'),
    -- Row 46
    ('Free People', 'We The Free Jojo Washed Oversized Funnel-Neck Jacket', 'Green', 'XL', 198.00, 21.43, 'enriched'),
    -- Row 47
    ('Free People', 'FREE PEOPLE MOVEMENT PIPPA PACKABLE PUFFER JACKET', 'Gray', 'M', 198.00, 21.43, 'enriched'),
    -- Row 48
    ('Free People', 'FP Movement Pippa Packable Puffer Jacket', 'Tan', 'S', 198.00, 21.43, 'enriched'),
    -- Row 49
    ('Free People', 'Free People Hit the Slopes Jacket', 'Black', 'S', 168.00, 21.43, 'enriched'),
    -- Row 50
    ('Free People', 'Free People Prairie Top', 'Ivory / Cream', 'L', 98.00, 21.43, 'enriched'),
    -- Row 51
    ('Free People', 'Free People Lace Cotton Top', 'White', 'L', 68.00, 21.43, 'enriched'),
    -- Row 52
    ('Free People', 'Free People Prairie Field Top', 'Ivory / Cream', 'S', 98.00, 21.43, 'enriched'),
    -- Row 53
    ('Free People', 'Free People Prairie Field Top', 'Ivory / Cream', 'S', 98.00, 21.43, 'enriched'),
    -- Row 54
    ('Free People', 'Free People Prairie Field Top', 'Ivory / Cream', 'S', 98.00, 21.43, 'enriched'),
    -- Row 55
    ('Free People', 'FP Movement Breeze Blocker Jacket', 'White', 'L', 198.00, 21.43, 'enriched'),
    -- Row 56
    ('Free People', 'Mountain High Half-Zip Fleece', 'Light Blue', 'S', 98.00, 21.43, 'enriched'),
    -- Row 57
    ('Free People', 'FP Intimately Dynamic Duo Tee', 'Brown', 'XS', 58.00, 21.43, 'enriched'),
    -- Row 58
    ('Free People', 'FP Intimately Dynamic Duo Tee', 'Brown', 'XS', 58.00, 21.43, 'enriched'),
    -- Row 59
    ('Free People', 'FP Intimately So Soft Seamless Modal Long Sleeve Crewneck', 'Red', 'S', 38.00, 21.43, 'enriched'),
    -- Row 60
    ('Free People', 'FP Intimately So Soft Seamless Modal Long Sleeve Crewneck', 'Red', 'S', 38.00, 21.43, 'enriched'),
    -- Row 61
    ('Free People', 'We The Free Zandi Woven Quilted Boxy Cropped Jacket', 'Stripe', 'M', 198.00, 21.43, 'enriched'),
    -- Row 62
    ('Free People', 'FP Intimately Dynamic Duo Tee', 'Light Blue', 'M', 58.00, 21.43, 'enriched'),
    -- Row 63
    ('Free People', 'FP Intimately Dynamic Duo Tee', 'Light Blue', 'M', 58.00, 21.43, 'enriched'),
    -- Row 64
    ('Anthropologie', 'Daily Practice by Anthropologie Free Fall Dress at MarketFair Shoppes in Princeton, NJ', 'Purple', 'L', 128.00, 21.43, 'enriched'),
    -- Row 65
    ('Free People', 'We The Free Linen Button Down', 'White', 'S', 128.00, 21.43, 'enriched'),
    -- Row 66
    ('Free People', 'We The Free Linen Button Down', 'White', 'S', 128.00, 21.43, 'enriched'),
    -- Row 67
    ('Free People', 'We The Free Linen Button Down', 'White', 'S', 128.00, 21.43, 'enriched'),
    -- Row 68
    ('Free People', 'We The Free Linen Button Down', 'White', 'S', 128.00, 21.43, 'enriched'),
    -- Row 69
    ('Free People', 'We The Free Linen Button Down', 'White', 'S', 128.00, 21.43, 'enriched'),
    -- Row 70
    ('Free People', 'We The Free Linen Button Down', 'White', 'M', 128.00, 21.43, 'enriched'),
    -- Row 71
    ('Free People', 'We The Free Linen Button Down', 'White', 'M', 128.00, 21.43, 'enriched'),
    -- Row 72
    ('Free People', 'We The Free Linen Button Down', 'White', 'M', 128.00, 21.43, 'enriched'),
    -- Row 73
    ('Free People', 'We The Free Linen Button Down', 'White', 'XL', 128.00, 21.43, 'enriched'),
    -- Row 74
    ('Free People', 'We The Free Linen Button Down', 'White', 'XL', 128.00, 21.43, 'enriched'),
    -- Row 75
    ('Free People', 'We The Free Linen Button Down', 'White', 'XL', 128.00, 21.43, 'enriched'),
    -- Row 76
    ('Free People', 'We The Free Linen Button Down', 'White', 'XL', 128.00, 21.43, 'enriched'),
    -- Row 77
    ('Free People', 'We The Free Linen Button Down', 'White', 'XL', 128.00, 21.43, 'enriched'),
    -- Row 78
    ('Free People', 'Plaid socks', 'Plaid', 'One Size', 14.00, 21.43, 'enriched'),
    -- Row 79
    ('Free People', 'Plaid socks', 'Plaid', 'One Size', 14.00, 21.43, 'enriched'),
    -- Row 80
    ('Free People', 'Plaid socks', 'Plaid', 'One Size', 14.00, 21.43, 'enriched'),
    -- Row 81
    ('Free People', 'Plaid socks', 'Plaid', 'One Size', 14.00, 21.43, 'enriched'),
    -- Row 82
    ('Free People', 'Plaid socks', 'Plaid', 'One Size', 14.00, 21.43, 'enriched'),
    -- Row 83
    ('Free People', 'Plaid socks', 'Plaid', 'One Size', 14.00, 21.43, 'enriched'),
    -- Row 84
    ('Free People', 'Plaid socks', 'Plaid', 'One Size', 14.00, 21.43, 'enriched'),
    -- Row 85 (Accessories - Bags, blank description in PDF)
    ('Free People', 'Free People Item', 'Black', 'One Size', 38.00, 21.43, 'enriched'),
    -- Row 86
    ('Free People', 'Free People Item', 'Black', 'One Size', 38.00, 21.43, 'enriched'),
    -- Row 87
    ('Free People', 'Free People Item', 'Black', 'One Size', 38.00, 21.43, 'enriched'),
    -- Row 88
    ('Free People', 'Free People Item', 'Black', 'One Size', 38.00, 21.43, 'enriched'),
    -- Row 89
    ('Free People', 'Free People Item', 'Black', 'One Size', 38.00, 21.43, 'enriched'),
    -- Row 90
    ('Free People', 'Free People Item', 'Black', 'One Size', 38.00, 21.43, 'enriched'),
    -- Row 91
    ('Free People', 'Free People Item', 'Black', 'One Size', 38.00, 21.43, 'enriched'),
    -- Row 92
    ('Free People', 'Free People Item', 'Black', 'One Size', 38.00, 21.43, 'enriched'),
    -- Row 93
    ('Free People', 'Free People Item', 'Black', 'One Size', 38.00, 21.43, 'enriched'),
    -- Row 94
    ('Free People', 'Free People Item', 'Black', 'One Size', 38.00, 21.43, 'enriched'),
    -- Row 95 (Sapphire bags)
    ('Free People', 'Free People Item', 'Sapphire', 'One Size', 38.00, 21.43, 'enriched'),
    -- Row 96
    ('Free People', 'Free People Item', 'Sapphire', 'One Size', 38.00, 21.43, 'enriched'),
    -- Row 97
    ('Free People', 'Free People Item', 'Sapphire', 'One Size', 38.00, 21.43, 'enriched'),
    -- Row 98
    ('Free People', 'Free People Item', 'Sapphire', 'One Size', 38.00, 21.43, 'enriched'),
    -- Row 99
    ('Free People', 'Free People Item', 'Sapphire', 'One Size', 38.00, 21.43, 'enriched'),
    -- Row 100
    ('Free People', 'Free People Item', 'Sapphire', 'One Size', 38.00, 21.43, 'enriched'),
    -- Row 101
    ('Free People', 'Free People Item', 'Sapphire', 'One Size', 38.00, 21.43, 'enriched'),
    -- Row 102
    ('Free People', 'Free People Item', 'Sapphire', 'One Size', 38.00, 21.43, 'enriched'),
    -- Row 103
    ('Free People', 'Free People Item', 'Sapphire', 'One Size', 38.00, 21.43, 'enriched'),
    -- Row 104 (Metallic Silver bags)
    ('Free People', 'Free People Item', 'Metallic Silver', 'One Size', 38.00, 21.43, 'enriched'),
    -- Row 105
    ('Free People', 'Free People Item', 'Metallic Silver', 'One Size', 38.00, 21.43, 'enriched'),
    -- Row 106
    ('Free People', 'Free People Item', 'Metallic Silver', 'One Size', 38.00, 21.43, 'enriched'),
    -- Row 107
    ('Free People', 'Free People Item', 'Metallic Silver', 'One Size', 38.00, 21.43, 'enriched'),
    -- Row 108
    ('Free People', 'Free People Item', 'Metallic Silver', 'One Size', 38.00, 21.43, 'enriched'),
    -- Row 109
    ('Free People', 'Free People Item', 'Metallic Silver', 'One Size', 38.00, 21.43, 'enriched'),
    -- Row 110
    ('Free People', 'Free People Item', 'Metallic Silver', 'One Size', 38.00, 21.43, 'enriched'),
    -- Row 111
    ('Free People', 'Free People Item', 'Metallic Silver', 'One Size', 38.00, 21.43, 'enriched'),
    -- Row 112
    ('Free People', 'Free People Item', 'Metallic Silver', 'One Size', 38.00, 21.43, 'enriched'),
    -- Row 113
    ('Free People', 'Free People Movement My Time Tee', 'Pink', 'M', 48.00, 21.43, 'enriched'),
    -- Row 114
    ('Free People', 'We The Free Next Level Tee', 'Tan', 'S', 58.00, 21.43, 'enriched'),
    -- Row 115
    ('Free People', 'We The Free Next Level Tee', 'Tan', 'S', 58.00, 21.43, 'enriched'),
    -- Row 116
    ('Free People', 'We The Free Next Level Tee', 'Tan', 'S', 58.00, 21.43, 'enriched'),
    -- Row 117
    ('Free People', 'We The Free Next Level Tee', 'Tan', 'S', 58.00, 21.43, 'enriched'),
    -- Row 118
    ('Free People', 'Free People I Tops', 'Pink', 'S', 58.00, 21.43, 'enriched'),
    -- Row 119
    ('Free People', 'Free People I Tops', 'Pink', 'S', 58.00, 21.43, 'enriched'),
    -- Row 120
    ('Free People', 'FP Movement NWT - Billie Boxie Lightweight Insulated Jacket', 'Purple', 'L', 248.00, 21.43, 'enriched'),
    -- Row 121
    ('Free People', 'FP Movement NWT - Billie Boxie Lightweight Insulated Jacket', 'Purple', 'L', 248.00, 21.43, 'enriched'),
    -- Row 122
    ('Free People', 'FP Movement NWT - Billie Boxie Lightweight Insulated Jacket', 'Purple', 'L', 248.00, 21.43, 'enriched'),
    -- Row 123
    ('Free People', 'FP Movement NWT - Billie Boxie Lightweight Insulated Jacket', 'Purple', 'L', 248.00, 21.43, 'enriched'),
    -- Row 124
    ('Free People', 'FP Movement NWT - Billie Boxie Lightweight Insulated Jacket', 'Purple', 'L', 248.00, 21.43, 'enriched'),
    -- Row 125
    ('Free People', 'FP Movement Billie Boxy Lightweight Insulated Jacket', 'Tan', 'L', 248.00, 21.43, 'enriched'),
    -- Row 126
    ('Free People', 'FP Movement Billie Boxy Lightweight Insulated Jacket', 'Tan', 'L', 248.00, 21.43, 'enriched'),
    -- Row 127
    ('Free People', 'FP Movement Billie Boxy Lightweight Insulated Jacket', 'Tan', 'L', 248.00, 21.43, 'enriched'),
    -- Row 128
    ('Free People', 'Jojo Washed Oversized Funnel-Neck Jacket', 'Black', 'S', 198.00, 21.43, 'enriched'),
    -- Row 129
    ('Free People', 'Jojo Washed Oversized Funnel-Neck Jacket', 'Black', 'S', 198.00, 21.43, 'enriched'),
    -- Row 130
    ('Free People', 'Jojo Washed Oversized Funnel-Neck Jacket', 'Black', 'S', 198.00, 21.43, 'enriched'),
    -- Row 131
    ('Free People', 'FP Movement Breeze Blocker Jacket', 'Tan', 'S', 198.00, 21.43, 'enriched'),
    -- Row 132
    ('Free People', 'Free People Floral Crop Tank', 'Brown', 'XS', 98.00, 21.43, 'enriched'),
    -- Row 133
    ('Free People', 'Free People Floral Crop Tank', 'Brown', 'XS', 98.00, 21.43, 'enriched'),
    -- Row 134
    ('Free People', 'FP Movement Moon Magic Rain Parka', 'Navy/Black Combo', 'M', 298.00, 21.43, 'enriched'),
    -- Row 135
    ('Free People', 'FP Movement Moon Magic Rain Parka', 'Navy/Black Combo', 'M', 298.00, 21.43, 'enriched'),
    -- Row 136
    ('Free People', 'FP Movement Moon Magic Rain Parka', 'Navy/Black Combo', 'M', 298.00, 21.43, 'enriched'),
    -- Row 137
    ('Free People', 'FP Movement Moon Magic Rain Parka', 'Navy/Black Combo', 'M', 298.00, 21.43, 'enriched'),
    -- Row 138
    ('Free People', 'FP Movement Moon Magic Rain Parka', 'Navy/Black Combo', 'M', 298.00, 21.43, 'enriched'),
    -- Row 139
    ('Free People', 'Free People Prairie Top', 'Ivory / Cream', 'XS', 98.00, 21.43, 'enriched'),
    -- Row 140
    ('Free People', 'Free People Prairie Top', 'Ivory / Cream', 'XS', 98.00, 21.43, 'enriched'),
    -- Row 141
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 142
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 143
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 144
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 145
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 146
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 147
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 148
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 149
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 150
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 151
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 152
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 153
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 154
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 155
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 156
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 157
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 158
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 159
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 160
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 161
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 162
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 163
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 164
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 165
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 166
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 167
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 168
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 169
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 170
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 171
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 172
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 173
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 174
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 175
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 176
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 177
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 178
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 179
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 180
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 181
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 182
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 183
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 184
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 185
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 186
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 187
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 188
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 189
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 190
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 191
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 192
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 193
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 194
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 195
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 196
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 197
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 198
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 199
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 200
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 201
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 202
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 203
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 204
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 205
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 206
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 207
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 208
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 209
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 210
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 211
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 212
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 213
    ('Free People', 'FP Movement Varsity Blues Shorts - Mixed styles and colors', 'Multi-Color', 'M', 30.00, 21.43, 'enriched'),
    -- Row 214
    ('Free People', 'FP Movement Get Your Flirt On Shorts - Mix of sizes and colors', 'Multi-Color', 'M', 40.00, 21.43, 'enriched'),
    -- Row 215 (last row — cost = $20.98 to make total exactly $4,607.00)
    ('Free People', 'FP Movement Get Your Flirt On Shorts - Mix of sizes and colors', 'Multi-Color', 'M', 40.00, 20.98, 'enriched')
  RETURNING id
),
box_insert AS (
  INSERT INTO kickstart_bundle_boxes (box_number, status, sale_price, sold_at, shipping_charged)
  VALUES (2, 'complete', 5758.00, '2026-03-17', 248.37)
)
INSERT INTO kickstart_bundle_scans (box_number, intake_id)
SELECT 2, id FROM intake_inserts;
