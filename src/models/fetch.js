const fetch = require('node-fetch')

function addUrlQueryParams (endpoint, params) {
  let url = new URL(endpoint)
  if (params) {
    // append URL query paramenters
    Object.keys(params).forEach(key => {
      url.searchParams.append(key, params[key])
    })
  }
  return url
}

module.exports = async function (url, options = {}) {
  if (!url) {
    throw Error('url is a required parameter for fetch')
  }
  
  if (options.body) {
    // set content type to JSON by default
    options.headers = options.headers || {}
    options.headers['Content-Type'] = options.headers['Content-Type'] || 'application/json'
    // stringify JSON body if it's not a string already
    if (typeof options.body === 'object' && options.headers['Content-Type'] === 'application/json') {
      options.body = JSON.stringify(options.body)
    }
  }
  
  try {
    // add query parameters to URL
    let completeUrl = url
    if (options.query) {
      completeUrl = addUrlQueryParams(url, options.query)
    }
    const response = await fetch(completeUrl, options)
    const text = await response.text()
    if (response.ok) {
      // HTTP status 200 - 299
      try {
        // try to return JSON
        const json = JSON.parse(text)
        return json
      } catch (e) {
        // return raw text when JSON parsing fails
        return text
      }
    } else {
      // HTTP status not 200 - 299
      let message = text || ''
      // console.log('bad http:', message)
      try {
        const json = JSON.parse(text)
        // message = json.message
        message = json.error_description || json.error || json.message || text || ''
      } catch (e) {
        // continue
      }
      const error = Error(`${response.status} ${response.statusText} - ${message}`)
      error.status = response.status
      error.statusText = response.statusText
      error.text = message
      error.response = response
      throw error
    }
  } catch (e) {
    // just rethrow any other errors, like connection timeouts
    throw e
  }
}
