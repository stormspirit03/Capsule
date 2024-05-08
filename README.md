  <h1> Documentation </h1>
  <h2> High level Description </h2>
    - This codebase implements a search functionality for the user to search and compare the prices of the products in the pharmacies <br>
    - It uses Elasticsearch for searching the products and Redis for caching the inventory data of the pharmacies along with prices. <br>
    - The search results are a combination of salt_suggestions, medicine_suggestions, and health_suggestions with prices. <br>
    
  <h2> Code Description </h2>
    The code is divided into 3 main functions. <br>
    1. new_search() <br>
    2. extractSuggestions() <br>
    3. getProduct() <br> <br>
    Also, there are 2 helper functions. <br>
    1. create_redis_inv() <br>
    2. getNearestPharmacy() <br>
 

  <h3> new_search function() </h3>
    This function is the main function that is called when the user searches for a product. <br>
    It takes the query and pharmacyIds as input. <br>
    It searches the query in the Elasticsearch indexes and extracts the salt suggestions, medicine suggestions, and health suggestions. <br>
    It calls the extractSuggestions function to extract the product suggestions from the elastic search results. <br>
    Also, calls the getProduct function to get the availability and prices of the products in the pharmacies. <br>
    Then it combines the product suggestions with the availability and prices of the products in the pharmacies, sorts and returns the final data. <br>

  <h3> extractSuggestions function() </h3>
    This function takes the search results as input <br>
    Extracts and returns the salt_suggestion, medicine_suggestions and health_suggestions from the search results. <br>
    
  <h3> getProduct function() </h3>
    This function takes the pharmacyIds and productId as input. <br>
    It retrieves the pharmacies those have the product available and its selling price. <br>

  <h3> create_redis_inv function() </h3>
    This function creates a redis key by stringifying the pharmacyIds  <br>
    and stores the inventory data in the redis for the specific pharmacyIds combination. <br>

  <h3> getNearestPharmacy function() </h3>
    This function retrieves the nearest pharmacies based on the user's location. <br>
    Max 10 pharmacies are retrieved and array of objects containing pharmacy id and distance from the user's location is returned. <br>

  <h2> Improvements() </h2>
    1. Proper error handling and logging to help to point exact issue and can bind user to log , so we know which user faced the issue. <br>
    2. Map is applied on getNearestPharmacies array to get id and location , and then again map is applied at the time of creating the redis entry. <br>
       Either we send complete array and map only at time of usage or just send the ids only. First one is more scalable. <br>
    3. If there is cache miss, it should check in DB. Also in worst scenario should return proper response. <br>

  <h2> Optimization() </h2>
    1. Indexing: Ensure that the pharmacy_id column in your inventory table is indexed. <br>
       This can significantly speed up queries that filter on this column. <br>
    2. Projection: If you only need certain fields from the inventory records,  <br>
       this can reduce the amount of data transferred from the database. <br>

  <h2> Pitfalls </h2>
    1. Data is cached against nearestPharmacyIds as a key. Only with 100 pharmacies and considering only <br>
        upto 10 pharmacies are taken to create a redis key. <br>
        The number of unique combinations of 10 pharmacies from a set of 100, where order matters, is 100P10 = 100! / (100-10)!. <br>
        This is a very large number, approximately 2.82 x 10^21. Not sustainable. <br>
    2. ExtractSuggestion is defined inside search newsearch.  <br>
        JavaScript has to create a new instance of extractSuggestions every time new_search is called.    <br>
    3. No cache expiry time or chache policy implemented, over the time it will keep on piling up cached data <br>
        and will be a tough task to restore the cache incase of server down. <br>

  <h2> Naming issues: </h2>
    Although this is not considerable but will save lots of implementation time in future and bring clarity to the code. <br>
    1. getProduct() => getProductPrice(). <br>
    2. getNearestPharmacy() should be pural as it returns array of pharmacyids.    <br>


  <h2>Product Suggestions: </h2>
    1. A lot of product success depends upon , pharmacist adopting the application and updating the inventory regularly. <br>
         Considering this, we should have a mechanism to notify the pharmacist to update the inventory and make it as easy as possible. <br>
    2. Searching pharmacy product via typing can be difficult forr the user, something like OCR based search can be implemented, <br>
       Where user just need to click the photo ( But this is not needed for MVP). <br>
