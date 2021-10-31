'use strict';

const HELPER_BASE = process.env.HELPER_BASE || '../../helpers/';
const Response = require(HELPER_BASE + 'response');

const fetch = require('node-fetch');
const Headers = fetch.Headers;

const CLIENT_ID = '【クライアントID】';
const CLIENT_SECRET = '【クライアントシークレット】';
const API_KEY = "【適当なAPIキー】";

exports.handler = async (event, context, callback) => {
	if( event.path == '/googleapi-webhooks' ){
		console.log('/googleapi-webhooks called');
		console.log(event);
		return new Response({});
	}else
  if (event.path == '/googleapi-token') {
    if (event.requestContext.apikeyAuth.apikey != API_KEY)
      throw 'apikey mismatch';

    var body = JSON.parse(event.body);

    var params = {
      code: body.code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: body.redirect_uri,
      grant_type: "authorization_code",
    };
    var result = await do_post('https://www.googleapis.com/oauth2/v4/token', params);
    console.log(result);

    return new Response(result);
  }
  if (event.path == '/googleapi-refreshtoken') {
    if (event.requestContext.apikeyAuth.apikey != API_KEY)
      throw 'apikey mismatch';

    var body = JSON.parse(event.body);
    console.log(body);

    var params = {
      refresh_token: body.refresh_token,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
    };
    var result = await do_post('https://www.googleapis.com/oauth2/v4/token', params);
    console.log(result);

    return new Response(result);
  }
};

function do_post(url, body) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8"
  });

  return fetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: headers
    })
    .then((response) => {
      if (!response.ok)
        throw 'status is not 200';
      return response.json();
    });
}