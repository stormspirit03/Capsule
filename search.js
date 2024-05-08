
module.exports.new_search = async (req, res, next) => {
    try {
      let query = req.query.q;
      query = query.replace(/\s+/g, " ");
      let pharmacyIds = req.body.pharmacyIds
  
      pharmacyIds = JSON.stringify(pharmacyIds)
  
  
      const OPENSEARCH_ENDPOINT = OPENSEARCH_URL;
      const INDEX_NAME = OPENSEARCH_INDEX;
      const headers = {
        "Content-Type": "application/json",
        Authorization: OPENSEARCH_AUTH,
      };
  
      const client = new Client({ node: OPENSEARCH_ENDPOINT, headers });
     // this query is a multi search query that searches in two indexes. index_salt and index_medicine.
     // the outpurt is a combination of salt suggestions, medicine suggestions and health suggestions.
     // salt suggestion is  for example if the user searches for "paracetamol" then the salt suggestions will be "paracetamol" and "paracetamol 500mg".
      const requestBody = `
  {"index": "index_salt"}
  {"_source": ["salt", "salt_frequency","salt_id","salt_forms_json","available_forms","most_common"], "size": 20, "query": {"multi_match": {"query": "${query}", "fields": ["salt", "name_suggest"]}}}
  {"index": "index_medicine"}
  {"_source": ["name_with_short_pack", "id", "salt_full", "manufacturer_name", "salt_or_category","is_healthProduct"], "size": 50, "query": {"bool": {"should": [{"multi_match": {"query": "${query}", "fields": ["name_with_short_pack"],"fuzziness": "AUTO"}},{"multi_match": {"query": "${query}", "fields": ["salt_full"]}},{"multi_match": {"query": "${query}", "fields": ["manufacturer_name"]}}]}}}
  `;
  
      const response = await client.msearch({ body: requestBody });
      const { body } = response;
      const responses = body.responses;
  
  
      const cachedData = await redisClient.get(pharmacyIds);
      // checking if the data is present for the specific key.
      // if not then setting the data in redis.
      // if yes leave it.
      if (!cachedData) {
        console.log("executed")
        // for each combination pharmacy ids data is stored in redis. which doesnt look sustainable.
        pharmacyIds = await create_redis_inv(req, res, next);
  
      }
  
  // This function extracts the medicine, and health suggestions from the search results.
      async function extractSuggestions(result) {
        const extractedData = {
          saltSuggestions: [],
          medicineSuggestions: [],
          healthSuggestions: [],
        };
        
        // Extract salt suggestions
        if (result && result[0]?.hits.hits.length !== 0) {
          const saltSuggestions = result[0]?.hits.hits || [];
          extractedData.saltSuggestions = await Promise.all(saltSuggestions
            .map(async (item) => {
              productDetails = {
                id: item._source.salt_id,
                salt: item._source.salt,
                salt_frequency: item._source.salt_frequency,
                available_forms: item._source.available_forms,
                most_common: item._source.most_common,
                salt_forms_json: item._source.salt_forms_json,
              }
              // checks availability and price of the product in the pharmacies.
              const availability = await getProduct(pharmacyIds, item._source.salt_id);
              // this will return the salt suggestions with the availability and price of the product in the pharmacies.
              return { ...productDetails, availability };  
                        /* 
                         output will look like
                          {
                              saltSuggestions: [
                                {
                                  id: 'salt1',
                                  salt: 'Salt A',
                                  salt_frequency: 10,
                                  available_forms: ['tablet', 'capsule'],
                                  most_common: 'tablet',
                                  salt_forms_json: '{"tablet": 10, "capsule": 5}',
                                  availability: {
                                    pharmacy1: { available: true, price: 10 },
                                    pharmacy2: { available: false, price: null },
                                    // ...
                                  },
                                },
                                {
                                  id: 'salt2',
                                  salt: 'Salt B',
                                  salt_frequency: 20,
                                  available_forms: ['tablet'],
                                  most_common: 'tablet',
                                  salt_forms_json: '{"tablet": 20}',
                                  availability: {
                                    pharmacy1: { available: false, price: null },
                                    pharmacy2: { available: true, price: 15 },
                                    // ...
                                  },
                                },
                                // ...
                              ],
                              // ...
                        } */
            }))
          extractedData.saltSuggestions.sort((a, b) => a.salt_frequency - b.salt_frequency);// this does sorting on the basis of salt frequency using algorithm called
        }
  
        // Extract medicine suggestions
        if (result && result[1]?.hits.hits.length !== 0) {
          const medicineSuggestions = result[1]?.hits.hits || [];
  
          extractedData.medicineSuggestions = await Promise.all(
            medicineSuggestions
              .filter((item) => item._source.is_healthProduct === false)
              .map(async (item) => {
                const productDetails = {
                  id: item._source.id,
                  salt_full: item._source.salt_full,
                  manufacturer_name: item._source.manufacturer_name,
                  salt_or_category: item._source.salt_or_category,
                  name_with_short_pack: item._source.name_with_short_pack,
                };
                const availability = await getProduct(pharmacyIds, item._source.id);
                return { ...productDetails, availability };
              })
          );
        }
  
        // Extract health suggestions
        if (result && result[1]?.hits.hits.length !== 0) {
          const healthSuggestions = result[1]?.hits.hits || [];
          extractedData.healthSuggestions = await Promise.all(healthSuggestions
            .filter((item) => item._source.is_healthProduct === true)
            .map(async (item) => {
              const productDetails = {
                id: item._source.id,
                salt_full: item._source.salt_full,
                manufacturer_name: item._source.manufacturer_name,
                salt_or_category: item._source.salt_or_category,
                name_with_short_pack: item._source.name_with_short_pack,
                is_healthProduct: item._source.is_health_product,
              };
              const availability = await getProduct(pharmacyIds, item._source.id);
              return { ...productDetails, availability };
            })
          );
        }
  
        return extractedData;
      }


      const extractedSuggestions = await extractSuggestions(responses);
  
      let final_data = extractedSuggestions;
      return res.status(200).json({ data: final_data });
    } catch (error) {
      // sending error with 200 status code to handle the error in the frontend.
      return res.status(200).json({ error: error.message });
    }
  };
  
  
  // This function retrives pharmacies those  have the product available and its selling price. 
  //output looks like [{pharmacy_id: 1, selling_price: 100}, {pharmacy_id: 2, selling_price: 200}]
  const getProduct = async (pharmacyIds, productId) => {
    try {
      // Check if the availability data is cached in Redis
      const cachedData = await redisClient.get(pharmacyIds);

      if (!cachedData) {
        // If the data is not cached, return an empty object
        return {};
      }

      // Parse the cached data
      const dataArray = JSON.parse(cachedData);
      const inventorysub = dataArray.inventorysub;

      // Filter the inventory data to get the availability of the specified product
      const filteredData = inventorysub
        .filter((item) => item.product_id === productId)
        .map((item) => ({
          pharmacy_id: item.pharmacy_id,
          selling_price: item.selling_price,
        }));

      return filteredData;
    } catch (error) {
      console.error(error);
      throw new Error("Internal server error");
    }
  };
  
  // this function creates a redis key for the pharmacyIds and stores the inventory data in the redis for the specific pharmacyIds combination.
  const create_redis_inv = async (req, res, next) => {
    try {
  
      const nearestPharmacy = await getNearestPharmacy(req, res, next); // this returns array of objects containing pharmacy id and distance from the user's location.
  
      let pharmacyIds = nearestPharmacy.map((pharmacy) => pharmacy.id); // it will look like [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  
  
    // inventorysub is the inventory data of the pharmacies.
      const inventorysub = await db.inventory.findAll({
        where: {
          pharmacy_id: pharmacyIds,
        },
      });
  
      pharmacyIds = JSON.stringify(pharmacyIds);
  
  
  
      redisClient.set(pharmacyIds, JSON.stringify({ inventorysub })); // it will set the data in redis with the key as pharmacyIds and value as the inventory data.
  
  
      return pharmacyIds;
    } catch (error) {
      console.log(error);
      throw new Error("Internal server error");
    }
  };
  
  // this function retrieves the nearest pharmacies based on the user's location. total 10 pharmacies are retrieved.
  // array of objects containing pharmacy id and distance from the user's location is returned.
  const getNearestPharmacy = async (req, res, next) => {
    try {
      const userLatitude = req.body.latitude;
      const userLongitude = req.body.longitude;
  
      if (!userLatitude || !userLongitude) {
        throw new Error("Latitude and longitude are required.");
      }
  
      const pharmacies = await Phar_address.findAll({
        attributes: {
          include: [
            [
              sequelize.literal(
                `ST_Distance(location, ST_SetSRID(ST_MakePoint(${userLongitude}, ${userLatitude}), 3857))`
              ),
              "distance",
            ],
          ],
        },
        order: sequelize.literal("distance"),
        limit: 10,
      });
  // mapping the pharmacy id and distance from the user's location. output will look like [{id: 1, distance: 100}, {id: 2, distance: 200}]
      const nearestPharmacies = pharmacies.map((pharmacy) => {
        return {
          id: pharmacy.id,
          distance: pharmacy.dataValues.distance,
        };
      });
  
      return nearestPharmacies;
    } catch (error) {
      console.log(error);
    }
  };//
  

  /*


  /*
    <h1> Documentation: </h1>
    <h2> High level Description: </h2>
    This codebase is trying to implement a search functionality for an user search and compare the prices of the products in the pharmacies nearby.
    It uses Elasticsearch for searching the products and Redis for caching the inventory data of the pharmacies along with prices.
    The search results are a combination of salt suggestions, medicine suggestions and health suggestions with prices.
    
    <h2> Code Description: </h2>
    The code is divided into 3 main functions.
    1. new_search
    2. extractSuggestions
    3. getProduct
    Also, there are 2 helper functions.
    1. create_redis_inv
    2. getNearestPharmacy
 

    <h3> new_search function: </h3>
    This function is the main function that is called when the user searches for a product. It takes the query and pharmacyIds as input.
    It searches the query in the Elasticsearch indexes and extracts the salt suggestions, medicine suggestions and health suggestions.
    It calls the extractSuggestions function to extract the product suggestions from the elastcisearch results.
    Also, calls the getProduct function to get the availability and prices of the products in the pharmacies.
    Then it combines the product suggestions with the availability and prices of the products in the pharmacies, sorts and returns the final data.

    <h3> extractSuggestions function: </h3>
    This function takes the search results as input and 
    extracts and return the salt_suggestion, medicine_suggestions and health_suggestions from the search results.
    
    <h3> getProduct function: </h3>
    This function takes the pharmacyIds and productId as input.
    It retrieves the pharmacies those have the product available and its selling price.

    <h3> create_redis_inv function: </h3>
    This function creates a redis key by stringifying the pharmacyIds 
    and stores the inventory data in the redis for the specific pharmacyIds combination.

    <h3> getNearestPharmacy function: </h3>
    This function retrieves the nearest pharmacies based on the user's location.
    Max 10 pharmacies are retrieved and array of objects containing pharmacy id and distance from the user's location is returned.

    <h2> Improvements: </h2>
    1. Proper error handling and logging to help to point exact issue and can bind user to log , so we know which user faced the issue.
    2. Map is applied on getNearestPharmacies array to get id and location , and then again map is applied at the time of creating the redis entry.
       Either we send complete array and map only at time of usage or just send the ids only. First one is more scalable.
    3. If there is cache miss, it should check in DB. Also in worst scenario should return proper response.

    <h2> Optimization: </h2>
    1. Indexing: Ensure that the pharmacy_id column in your inventory table is indexed. 
       This can significantly speed up queries that filter on this column.
    2. Projection: If you only need certain fields from the inventory records, 
       this can reduce the amount of data transferred from the database.

    <h2> Pitfalls </h2>
    1. Data is cached against nearestPharmacyIds as a key. Only with 100 pharmacies and considering only upto 10 pharmacies are taken to create a redis key.
        The number of unique combinations of 10 pharmacies from a set of 100, where order matters, is 100P10 = 100! / (100-10)!.
        This is a very large number, approximately 2.82 x 10^21. Not sustainable.
    2. ExtractSuggestion is defined inside search newsearch. 
        JavaScript has to create a new instance of extractSuggestions every time new_search is called.    
    
    3. No cache expiry time or chache policy implemented, over the time it will keep on piling up cacheed data and will be a tough task to
        manage the cache.

    <h2> Naming issues: </h2>
    Although this is not considerable but will save lots of implementation time in future and bring clarity to the code.
    1. getProduct() => getProductPrice().
    2. getNearestPharmacy() should be pural as it returns array of pharmacyids.    


    <h2>Product Suggestions: </h2>
    1. A lot of product success depends upon , pharmacist adopting the application and updating the inventory regularly.
       Considering this, we should have a mechanism to notify the pharmacist to update the inventory and make it as easy as possible.
    2. Searching pharmacy product via typing can be difficult forr the user, something like OCR based search can be implemented, 
       Where user just need to click the photo ( But this is not needed for MVP).
    

       */
