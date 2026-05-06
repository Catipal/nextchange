from PIL import Image, ImageDraw

def make_circle():
    img = Image.open('public/logo.png').convert("RGBA")
    
    # Make it a square if it's not
    size = min(img.size)
    
    # Crop to square
    left = (img.size[0] - size) / 2
    top = (img.size[1] - size) / 2
    right = (img.size[0] + size) / 2
    bottom = (img.size[1] + size) / 2
    img = img.crop((left, top, right, bottom))

    # Create mask
    mask = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, size, size), fill=255)
    
    output = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    output.paste(img, (0, 0), mask)
    
    output.save('public/logo_circular.png')

if __name__ == '__main__':
    make_circle()
