
const result = {
  parameters: {
    fields: {
      session: {
        numberValue: 123456,
        kind: 'numberValue'
      }
    }
  }
}
// get a more usable parameter JSON
const keys = Object.keys(result.parameters.fields)
const output = {}
for (const key of keys) {
  const param = result.parameters.fields[key]
  output[key] = param[param.kind]
}
console.log(output)
