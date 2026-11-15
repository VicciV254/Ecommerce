/**
 * Development placeholder photos, hotlinked from the providers' CDNs under their free licences.
 * They are labelled as samples in the UI and never stand in for real merchant photography.
 * Credits and source pages come from the providers' published metadata, gathered 2026-11-15.
 */
const unsplash = (photo, page, photographer, width, height) => ({
  url: `https://images.unsplash.com/${photo}?w=1200&auto=format&fit=max&q=75`,
  sourceUrl: page, license: 'https://unsplash.com/license',
  credit: `Photo by ${photographer} on Unsplash`, width, height, isPlaceholder: true,
});
const pexels = (id, page, photographer, width, height) => ({
  url: `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=1200`,
  sourceUrl: page, license: 'https://www.pexels.com/license/',
  credit: `Photo by ${photographer} on Pexels`, width, height, isPlaceholder: true,
});

/** Two photos per department where clean ones were available; products alternate between them. */
export const departmentPhotos = {
  'phones-tablets': [
    unsplash('photo-1524226108234-3cccbbbfa86d', 'https://unsplash.com/photos/two-phones-on-white-table-f-gxmsZlj9c', 'Steve A Johnson', 4807, 3205),
    pexels(3945679, 'https://www.pexels.com/photo/white-ipad-on-white-table-3945679/', 'cottonbro studio', 4000, 6000),
  ],
  'tvs-audio': [
    unsplash('photo-1505740420928-5e560c06d30e', 'https://unsplash.com/photos/PDX_a_82obo', 'Malte Wingen', 5760, 3840),
    unsplash('photo-1637747022694-92c8cbc90a38', 'https://unsplash.com/photos/modern-media-console-with-woven-doors-and-a-large-television-q5oqHDj9YoE', 'Usman Mehmood', 5426, 3853),
  ],
  appliances: [
    unsplash('photo-1484154218962-a197022b5858', 'https://unsplash.com/photos/gray-steel-3-door-refrigerator-near-modular-kitchen-MP0bgaS_d1c', 'Naomi Hébert', 4288, 2848),
    unsplash('photo-1685131703480-8d18b25a82c3', 'https://unsplash.com/photos/a-blender-sitting-on-top-of-a-counter-next-to-fruit-HB6jSg_r0B0', 'Tim Welsh', 8272, 6200),
  ],
  'health-beauty': [
    unsplash('photo-1702475139156-6cc9d6bc5898', 'https://unsplash.com/photos/a-dropper-bottle-with-a-dropper-on-top-of-it-XiLOp5DvH6Q', 'Mockup Free', 5460, 3642),
    pexels(4041391, 'https://www.pexels.com/photo/set-of-cosmetic-bottle-with-pink-rose-on-wooden-plate-4041391/', 'Karolina Grabowska', 4410, 6615),
  ],
  'home-office': [
    unsplash('photo-1781720077891-4e90c15b972c', 'https://unsplash.com/photos/two-ergonomic-office-chairs-dark-and-light-facing-each-other-IqND6s1rXAo', 'Sou Jest', 5568, 3712),
    unsplash('photo-1555041469-a586c61ea9bc', 'https://unsplash.com/photos/green-fabric-sofa-fZuleEfeA1Q', 'Phillip Goldsberry', 5760, 3840),
  ],
  fashion: [
    unsplash('photo-1736322969168-7105551d1798', 'https://unsplash.com/photos/a-room-that-has-a-bunch-of-clothes-hanging-on-a-rack-5iQrhv2iT0c', 'Egor Myznik', 6048, 4032),
    unsplash('photo-1558368204-cc52a4a4e519', 'https://unsplash.com/photos/white-tote-bag-hanged-on-metal-rack-WeG2bHKSUo0', 'Thom Bradley', 6016, 4000),
  ],
  computing: [
    unsplash('photo-1629317480826-910f729d1709', 'https://unsplash.com/photos/black-and-silver-laptop-computer-on-brown-wooden-table-iTUZ7VcJI8M', 'Workperch', 4032, 3024),
    unsplash('photo-1585792180666-f7347c490ee2', 'https://unsplash.com/photos/black-and-white-laptop-computer-183F_vNaN8A', 'Nicolas Gonzalez', 5851, 3873),
  ],
  gaming: [
    unsplash('photo-1580327332925-a10e6cb11baa', 'https://unsplash.com/photos/black-sony-ps-4-game-controller-2W0eSl3AAu0', 'Igor Karimov', 3600, 5139),
  ],
  supermarket: [
    unsplash('photo-1661195864414-5063132e8823', 'https://unsplash.com/photos/a-table-is-filled-with-fruits-BgeLpsrz454', 'Kaja Sariwating', 6000, 4000),
    unsplash('photo-1590004828648-96f9eb977764', 'https://unsplash.com/photos/sliced-orange-fruit-on-white-surface-Qirg97-5pp0', 'Estúdio Bloom', 3831, 3065),
  ],
  'baby-products': [
    pexels(6990411, 'https://www.pexels.com/photo/an-army-of-colorful-wooden-blocks-men-6990411/', 'DS stories', 8361, 5574),
    pexels(35723203, 'https://www.pexels.com/photo/adorable-plush-polar-bears-in-basket-display-35723203/', 'quang vinh', 4000, 6000),
  ],
  'sporting-goods': [
    unsplash('photo-1584735935682-2f2b69dff9d2', 'https://unsplash.com/photos/dumbbells-and-resistance-band-workout-IZOAOjvwhaM', 'Kelly Sikkema', 5180, 3453),
    unsplash('photo-1591291621164-2c6367723315', 'https://unsplash.com/photos/pink-dumbbell-on-pink-textile-erUC4fTtCuo', 'Elena Kloppenburg', 7643, 5095),
  ],
  automobile: [
    pexels(3855223, 'https://www.pexels.com/photo/crop-mechanic-choosing-metal-tools-for-repair-in-garage-3855223/', 'Andrea Piacquadio', 5760, 3840),
    pexels(7564865, 'https://www.pexels.com/photo/a-mechanic-fixing-an-engine-7564865/', 'cottonbro studio', 6240, 4160),
  ],
  'garden-outdoors': [
    unsplash('photo-1573561368183-fd88bdb4503d', 'https://unsplash.com/photos/a-row-of-yellow-garden-tools-sitting-on-top-of-a-wooden-floor-9EH5AkClwZ0', 'Luís Feliciano', 2928, 2024),
    unsplash('photo-1559065303-579e9effb798', 'https://unsplash.com/photos/basket-of-gardening-tools-uETpuHPWxTE', 'Vlad Vasnetsov', 6016, 4016),
  ],
  'books-movies-music': [
    unsplash('photo-1458560871784-56d23406c091', 'https://unsplash.com/photos/5gn2soeAc40', 'Adrian Korte', 3942, 2957),
    unsplash('photo-1593430980369-68efc5a5eb34', 'https://unsplash.com/photos/books-on-brown-wooden-shelf-YbLitAY8bPA', 'Pickawood', 5386, 3530),
  ],
};

/**
 * Extra photos for two showcase products, so galleries and variant images can be exercised.
 * Each shows a different item; alt text says so rather than claiming another view of the product.
 */
export const galleryPhotos = {
  fashion: [
    { ...pexels(3944693, 'https://www.pexels.com/photo/blue-and-white-checkered-top-beside-denim-shoes-3944693/', 'Castorly Stock', 6000, 4000), variant: 'Navy' },
    { ...pexels(36743233, 'https://www.pexels.com/photo/colorful-men-s-clothing-on-grass-background-36743233/', 'snazzy Photography', 4080, 3072), variant: 'Gold' },
    pexels(19895960, 'https://www.pexels.com/photo/red-t-shirt-on-gray-background-19895960/', 'Marcelo Verfe', 2287, 3282),
  ],
  'phones-tablets': [
    unsplash('photo-1557767382-97b28f5488e7', 'https://unsplash.com/photos/black-smartphone-with-charger-cord-connected-W9Z87k4hV08', 'Andreas Haslinger', 6240, 4160),
    pexels(3945679, 'https://www.pexels.com/photo/white-ipad-on-white-table-3945679/', 'cottonbro studio', 4000, 6000),
  ],
};
