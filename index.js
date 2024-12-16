const fs = require("fs");
const { BookingScrape } = require("./scraper");

// Scrape Prices

const writeLogEntry = (data, path) => {
  fs.appendFileSync(path, JSON.stringify(data) + "\n");
  return data;
};

const listings = fs.readFileSync("./united_kingdom.json", {
  encoding: "utf8",
  flag: "r",
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  let count = 1;
  const maxConcurrentRequests = 5;
  const delayBetweenBatches = 1000; // Delay in milliseconds

  const processHotel = async (hotel, booking) => {
    try {
      if (!hotel.hotel) {
        throw new Error("Label is undefined!");
      }
      const href = await booking.queryHotel(hotel.hotel);

      if (!href) {
        throw new Error("Missing href!");
      }

      const metadata = await booking.scrapeMetadata(href);

      const page = href
        .match(/\/([^\/?]+\.html)/)?.[1]
        .replace(".html", "")
        .split(".")[0];
      const countryCode = href.match(/\/hotel\/([a-z]{2})\//)[1];

      const prices = (
        await booking.scrapePrices(page, countryCode.toLowerCase())
      ).map(({ avgPriceFormatted, checkin }) => ({
        avgPriceFormatted,
        checkin,
      }));

      // Log Prices
      writeLogEntry(
        {
          sheet_hotel: hotel.hotel,
          hotelId: hotel.hotel,
          prices,
        },
        "./logs/hotel-prices.jsonl"
      );

      // Log Metadata
      writeLogEntry(
        {
          sheet_hotel: hotel.hotel,
          ...metadata,
        },
        "./logs/hotel-metadata.jsonl"
      );
    } catch (error) {
      console.log(error);
      writeLogEntry(
        {
          sheet_hotel: hotel.hotel,
          hotel_label: hotel.label,
        },
        "./logs/failed.jsonl"
      );
    }
    console.log(`[${count++}/18906]`);
  };

  const hotelQueue = JSON.parse(listings).slice(299); // Make a copy of listings

  const promises = [];
  while (hotelQueue.length > 0) {
    const booking = new BookingScrape();
    // Start processing up to maxConcurrentRequests
    while (promises.length < maxConcurrentRequests && hotelQueue.length > 0) {
      const hotel = hotelQueue.shift(); // Get the next hotel
      promises.push(processHotel(hotel, booking)); // Start processing it
    }

    // Wait for all current promises to settle
    await Promise.allSettled(promises);
    promises.length = 0; // Clear the array for the next batch

    // Add delay between batches
    await delay(delayBetweenBatches);
  }
}

main();
