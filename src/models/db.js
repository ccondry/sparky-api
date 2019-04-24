const MongoClient = require('mongodb').MongoClient
// make sure environment file is loaded
require('dotenv').config()

const url = process.env.MONGO_URL
const clientOptions = { useNewUrlParser: true, poolSize: 5 }

// connection pool reference
let client

// create connection pool
function connect () {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject('process.env.MONGO_URL is not defined. please add this to the .env file.')
    }
    try {
      MongoClient.connect(url, clientOptions, function(connectError, dbClient) {
        if (connectError) {
          reject(connectError)
        } else {
          console.log('cloud mongo db connected')
          client = dbClient
          resolve(dbClient)
        }
      })
    } catch (e) {
      reject(e)
    }
  })
}

function find (db, collection, query = {}, projections) {
  return new Promise((resolve, reject) => {
    try {
      client.db(db).collection(collection).find(query).project(projections)
      .toArray(function (queryError, doc) {
        // check for error
        if (queryError) reject(queryError)
        // success
        else resolve(doc)
      })
    } catch (e) {
      reject(e)
    }
  })
}

function findOne (db, collection, query, options) {
  return new Promise((resolve, reject) => {
    try {
      client.db(db).collection(collection).findOne(query, options, function (queryError, result) {
        if (queryError) reject(queryError)
        else resolve(result)
      })
    } catch (e) {
      reject(e)
    }
  })
}

function upsert (db, collection, query, data) {
  return new Promise((resolve, reject) => {
    try {
      client.db(db).collection(collection).findOneAndReplace(
        query,
        data,
        { upsert: true },
        function(queryError, doc) {
          if (queryError) reject(queryError)
          else resolve(doc)
        }
      )
    } catch (e) {
      return reject(e)
    }
  })
}

function update (db, collection, query, updates, options) {
  return new Promise((resolve, reject) => {
    try {
      client.db(db).collection(collection).update(
        query,
        updates,
        options,
        function(queryError, doc) {
          if (queryError) reject(queryError)
          else resolve(doc)
        }
      )
    } catch (e) {
      reject(e)
    }
  })
}

function insertOne (db, collection, data) {
  return new Promise((resolve, reject) => {
    try {
      client.db(db).collection(collection).insertOne(
        data,
        function(queryError, doc) {
          if (queryError) reject(queryError)
          else resolve(doc)
        }
      )
    } catch (e) {
      reject(e)
    }
  })
}

function remove (db, collection, query) {
  return new Promise((resolve, reject) => {
    try {
      client.db(db).collection(collection).remove(
        query,
        function(queryError, doc) {
          if (queryError) reject(queryError)
          else resolve(doc)
        }
      )
    } catch (e) {
      reject(e)
    }
  })
}

function removeOne (db, collection, query) {
  return new Promise((resolve, reject) => {
    try {
      client.db(db).collection(collection)
      .removeOne(query, function (err, result) {
        // check for error
        if (err) reject(err)
        // success
        else resolve(result)
      })
    } catch (e) {
      // failed to get client
      reject(e)
    }
  })
}

module.exports = {
  client,
  connect,
  find,
  findOne,
  update,
  upsert,
  insertOne,
  remove,
  removeOne
}
