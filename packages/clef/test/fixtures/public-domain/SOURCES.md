# Public-domain test images

Real-world images for exercising `@askif/clef`'s image input. Each one comes from Wikimedia Commons and
is in the public domain; none needs permission, but the credits below are kept so the provenance is traceable.
`manifest.json` has the same data (plus a SHA-256 per file and the questions with expected answers), and
`test/public-domain.test.ts` checks that the files still match it.

Retrieved 2026-10-06. Each file is a Commons-generated rendition of at most 960 px, not the original
(resizing a public-domain work doesn't change its status).

| File | Work | Creator | Date | Why it is public domain |
| --- | --- | --- | --- | --- |
| `cat.jpg` | [Photograph of pet cat taken by Tokugawa Yoshinobu](https://commons.wikimedia.org/wiki/File:Photograph_of_pet_cat_taken_by_Tokugawa_Yoshinobu.jpg) | Tokugawa Yoshinobu (徳川慶喜) | c. 1850s (19th century) | Public domain (age): Commons templates PD-old-100, PD-US-expired, PD-Japan-oldphoto |
| `dog.jpg` | [Bernese Mountain Dog and Her Pups](https://commons.wikimedia.org/wiki/File:Adam,_Benno,_Bernese_Mountain_Dog_and_Her_Pups.jpg) | Benno Adam (1812-1892) | 1862 | Public domain (age): Commons templates PD-Art, PD-old-X-expired, PD-US-expired |
| `bicycle.jpg` | [Ivel Racing Safety Bicycle, from Bartleet's Bicycle Book, No. 33](https://commons.wikimedia.org/wiki/File:1886._Ivel_Racing_Safety_Bicycle._From_%27Bartleet%27s_Bicycle_Book%27_No._33.jpg) | Unknown author | 1886 | Public domain (unknown author, published >70 years ago): Commons template PD-UK-unknown |
| `apple.png` | [USDA 2026 Apple half](https://commons.wikimedia.org/wiki/File:USDA_2026_Apple_half.png) | U.S. Department of Health and Human Services / USDA (federal government work) | 2026-01-08 | Public domain (US federal government work): Commons templates PD-USGov, PD-US. Uploader's attribution to a federal publication, not independently verified. |
| `earthrise.jpg` | [Earthrise (Apollo 8, AS8-14-2383)](https://commons.wikimedia.org/wiki/File:NASA-Apollo8-Dec24-Earthrise.jpg) | Bill Anders / NASA | 1968-12-24 | Public domain (US government work; NASA: 'generally not subject to copyright in the United States', credit NASA, imply no endorsement, https://www.nasa.gov/nasa-brand-center/images-and-media/). The Commons page has no formal PD tag; this rests on NASA's policy. |

Notes:
- **Earthrise** is a NASA photograph. NASA asks that it be credited as the source and not used to imply
  endorsement; it has no logos or identifiable people. Its Commons page lacks a formal PD tag, so its status rests
  on NASA's own media policy rather than on the Commons label.
- **Apple** is a US federal-government illustration; the attribution comes from the Commons uploader.
- No image shows an identifiable living person.
- Commons license labels are community-maintained and can be wrong, so before reusing any of these elsewhere, re-check the linked page.
