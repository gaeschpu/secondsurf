# Hero photos: sources

Since 24 November 2026 the hero shows the shop's own pieces: one big flat-lay of all available pieces (front views and
back views), made from the owner's own photos with the photo tool. No outside licences involved.

    npm run photos:background -- --haul src/assets/hero/1-haul-front.jpg
    npm run photos:background -- --haul src/assets/hero/2-haul-back.jpg --side back

Run both again after adding new pieces, then commit and push. Earlier hero photos (Pexels surf shops and clothing piles)
are in the git history.

The hero slider (src/pages/[...lang]/new.astro) shows every image in this folder, sorted by file name.
Only use photos you took yourself or have a licence for.
