const axios = require('axios')

async function getCustomerData(phone) {
  console.log('customer lookup failed on csHost with query_string:' + phone)
  // try to match up the phone number with a user's info
  const customerData = {}
  let customers
  try {
    // try main CS url
    customers = await request({
      url: `${session.csHost}/customer`,
      method: 'GET',
      qs: {
        q: `query_string:${phone}`
      },
      json: true
    })
  } catch (e2) {
    // try backup CS url
    console.log('customer lookup failed on csHost. trying csBackupHost...')
    try {
      customers = await request({
        url: `${session.csBackupHost}/customer`,
        method: 'GET',
        qs: {
          q: `query_string:${phone}`
        },
        json: true
      })
    } catch (e3) {
      console.log('customer lookup failed on csBackupHost', e3.message)
      throw e3
    }
  }

  let customer
  if (customers.length < 1) {
    throw 'no customers found matching ' + phone
  }
  if (customers.length > 1) {
    console.log('more than one customer found. choosing first customer and hoping for the best.')
    // choose first customer
    customer = customers[0]
  } else {
    console.log('found customer matching ', phone)
    customer = customers[0]
  }

  return customer
}

module.exports = {
  getCustomerData
}
