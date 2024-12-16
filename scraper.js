const puppeteer = require("puppeteer");
const cheerio = require("cheerio");
const fs = require("fs");
const { format, addMonths, addDays } = require("date-fns");
const axios = require("axios");

class BookingScrape {
  params = {
    sid: "ad1dbeb36ac48ee8e8b102f2672804f7",
    req_adults: 2,
    no_rooms: 1,
    group_children: 0,
    req_children: 0,
    lang: "en-us",
    from: "searchresults",
    cur_currency: "gbp",
    selected_currency: "GBP",
    checkin: format(new Date(), "yyyy-MM-dd"),
    checkout: format(addDays(new Date(), 1), "yyyy-MM-dd"),
  };

  writeLogEntry(data, path) {
    fs.appendFileSync(path, JSON.stringify(data) + "\n");
  }

  async fetchPage(url) {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    const content = await page.content();
    fs.writeFile("./test.html", content);

    await browser.close();
    return content;
  }

  async queryHotel(query) {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();

    const url = `https://www.booking.com/searchresults.en-gb.html?ss=${encodeURIComponent(
      query
    )}&${new URLSearchParams(this.params).toString()}`;

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    const $ = cheerio.load(await page.content());
    await browser.close();

    return $('a[data-testid="title-link"]').first().attr("href");
  }

  async scrapePrices(pageName, countryCode) {
    let promises = [];
    let prices = [];

    for (let i = 0; i < 12; i += 2) {
      const startDate = format(addMonths("2025-01-01", i), "yyyy-MM-dd");
      promises.push(
        new Promise(async (resolve, reject) => {
          const response = await axios.post(
            `https://www.booking.com/dml/graphql?${new URLSearchParams(
              this.params
            ).toString()}`,
            {
              operationName: "AvailabilityCalendar",
              variables: {
                input: {
                  travelPurpose: 2,
                  pagenameDetails: {
                    countryCode: countryCode.toLowerCase(),
                    pagename: pageName,
                  },
                  searchConfig: {
                    searchConfigDate: {
                      startDate: startDate,
                      amountOfDays: 61,
                    },
                    nbAdults: 2,
                    nbRooms: 1,
                    nbChildren: 1,
                    childrenAges: [0],
                  },
                },
              },
              extensions: {},
              query: `
              query AvailabilityCalendar($input: AvailabilityCalendarQueryInput!) {
                availabilityCalendar(input: $input) {
                  ... on AvailabilityCalendarQueryResult {
                    hotelId
                    days {
                      available
                      avgPriceFormatted
                      checkin
                      minLengthOfStay
                      __typename
                    }
                    __typename
                  }
                  ... on AvailabilityCalendarQueryError {
                    message
                    __typename
                  }
                  __typename
                }
              }
              `,
            }
          );

          const result = (await response.data).data?.availabilityCalendar?.days;

          if (result) {
            prices.push(...result);
            resolve();
          } else {
            reject();
          }
        })
      );
    }

    await Promise.all(promises);

    return prices.sort((a, b) => new Date(a.checkin) - new Date(b.checkin));
  }

  async scrapeMetadata(url) {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Get the HTML content of the page
    const html = await page.content();
    const $ = cheerio.load(html);
    await browser.close();

    const data = {
      label: $(".pp-header__title").first().text(),
      address: $('span > div[tabindex="0"]')
        .contents() // Gets all children, including text nodes
        .filter((_, el) => el.nodeType === 3) // Filters for text nodes only (nodeType === 3)
        .text()
        .trim(),
      photo_gallery: [],
      property_highlights: [],
      roomTypes: [],
    };

    // Get Address

    // Iterate over images in #photo_wrapper
    $("#photo_wrapper img").each((index, element) => {
      const src = $(element).attr("src");
      if (src) {
        data.photo_gallery.push(src);
      }
    });

    $('div[data-testid="property-highlights"] ul li').map((index, element) => {
      data.property_highlights.push($(element).text());
    });

    $('.roomstable div[style="--bui_stack_spaced_gap--s: 0;"]')
      .slice(1)
      .each((index, element) => {
        const type = $(element).find("a").first().text();

        const maxGuests = $('span[data-testid="adults-icon"]')
          .next()
          .find("span")
          .text();

        data.roomTypes.push({ type, maxGuests });
      });

    return data;
  }
}

module.exports = { BookingScrape };
