'use strict';

const HELPER_BASE = process.env.HELPER_BASE || '../../helpers/';
const Response = require(HELPER_BASE + 'response');
const BinResponse = require(HELPER_BASE + 'binresponse');
const jsonfile = require(HELPER_BASE + 'jsonfile-utils');

const TOKEN_FILE_PATH = process.env.THIS_BASE_PATH + '/data/googlephotos/access_token.json';
const IMAGE_LIST_FILE_PATH = process.env.THIS_BASE_PATH + '/data/googlephotos/image_list.json';
const ALBUM_LIST_FILE_PATH = process.env.THIS_BASE_PATH + '/data/googlephotos/album_list.json';
const UPDATE_IMAGE_LIST_INTERVAL = 60 * 60 * 24 * 1000;
const ALBUM_NAME = 'for Photo frame';

const API_KEY = "【適当なAPIキー】";
const api_url = 'https://【Node.jsサーバのホスト名】';

const sharp = require('sharp');
const jwt_decode = require('jwt-decode');
const filetype = require('file-type');

const { URL, URLSearchParams } = require('url');
const fetch = require('node-fetch');
const Headers = fetch.Headers;

exports.handler = async (event, context, callback) => {
  switch( event.path ){
    case '/googlephotos-get-username': {
      var json = await read_token();

      const decoded = jwt_decode(json.id_token);
      return new Response( { name: decoded.name, sub: decoded.sub });
    }
    case '/googlephotos-get-sharedalbum': {
      var json = await read_token();

      var album_list = await do_get_with_token('https://photoslibrary.googleapis.com/v1/sharedAlbums', {}, json.access_token);
      var albums = album_list.sharedAlbums || [];
      while(album_list.nextPageToken ){
        var params = {
          pageToken: album_list.nextPageToken
        };
        album_list = await do_get_with_token('https://photoslibrary.googleapis.com/v1/sharedAlbums', params, json.access_token);
        if (album_list.sharedAlbums )
          albums = albums.concat(album_list.sharedAlbums);
      }

      return new Response({ list: albums });
    }
    case '/googlephotos-get-albumlist': {
      var body = JSON.parse(event.body);

      var album_list = await read_album_list();
      return new Response({ list: album_list.list });
    }
    case '/googlephotos-update-albumlist': {
      var body = JSON.parse(event.body);
      console.log(body);

      var json = await read_token();
      var album_list = await read_album_list();
      album_list.list = body.list;

      await jsonfile.write_json(ALBUM_LIST_FILE_PATH, album_list);

      var list = await jsonfile.read_json(IMAGE_LIST_FILE_PATH, { data: [] });
      list.data = await get_all_image_list(album_list, json.access_token);
      list.update_at = new Date().getTime();
      await jsonfile.write_json(IMAGE_LIST_FILE_PATH, list);

      return new Response({});
    }
    case '/googlephotos-imagelist': {
      var json = await read_token();
      var list = await read_image_list(json);
      return new Response({ list: list.data });
    }
    case '/googlephotos-image': {
      const width = event.queryStringParameters.width ? Number(event.queryStringParameters.width) : 480;
      const height = event.queryStringParameters.height ? Number(event.queryStringParameters.height) : 320;
      const fit = event.queryStringParameters.fit || 'cover';

      var json = await read_token();
      var list = await read_image_list(json);

      if( list.data.length <= 0 )
        throw 'image_list is empty';

      var index = make_random(list.data.length - 1);
      var image = await do_get_buffer(list.data[index].baseUrl, {});

      var image_buffer = await sharp(Buffer.from(image))
        .resize({
          width: width,
          height: height,
          fit: fit
        })
        .jpeg()
        .toBuffer();

      return new BinResponse("image/jpeg", Buffer.from(image_buffer));
    }
    case '/googlephotos-account-create': {
      console.log(event.body);
      var body = JSON.parse(event.body);

      var params = {
        code: body.code,
        redirect_uri: body.redirect_uri
      };
      var result_token = await do_post_with_apikey(api_url + '/googleapi-token', params, API_KEY);
      console.log(result_token);

      var json = await jsonfile.read_json(TOKEN_FILE_PATH, {});
      json.access_token = result_token.access_token;
      json.id_token = result_token.id_token;
      if (result_token.refresh_token )
      json.refresh_token = result_token.refresh_token;
      json.scope = result_token.scope;
      json.token_type = result_token.token_type;
      json.expires_in = result_token.expires_in;
      json.created_at = new Date().getTime();

      await jsonfile.write_json(TOKEN_FILE_PATH, json);

      var album_list_json = await jsonfile.read_json(ALBUM_LIST_FILE_PATH, { list: [] });

      var album_list = await do_get_with_token('https://photoslibrary.googleapis.com/v1/albums', {}, json.access_token);
      var albums = album_list.albums || [];
      while( album_list.nextPageToken ){
        var params = {
          pageToken: album_list.nextPageToken
        };
        album_list = await do_get_with_token('https://photoslibrary.googleapis.com/v1/albums', params, json.access_token);
        if( album_list.albums )
          albums = albums.concat(album_list.albums);
      }

      var album = albums.find(item => item.title == ALBUM_NAME );
      if( !album ){
        var params2 = {
          album: {
            title: ALBUM_NAME
          }
        };
        album = await do_post_with_token('https://photoslibrary.googleapis.com/v1/albums', params2, json.access_token);
      }
      album_list_json.id = album.id;

      await jsonfile.write_json(ALBUM_LIST_FILE_PATH, album_list_json);

      return new Response({ title: ALBUM_NAME });
    }
    case '/googlephotos-sync-instagram':{
      var json = await read_token();

      var num = await sync_instagram(json);
      if( num > 0 )
        await update_image_list(json);

      return new Response({ num: num });
    }
  }
};

exports.trigger = async (event, context, callback) => {
  console.log('googlephotos.trigger cron triggered');

  var json = await read_token();
  console.log(json);
};

exports.trigger2 = async (event, context, callback) => {
  console.log('googlephotos.trigger2 cron triggered');

  var json = await read_token();
  var num = await sync_instagram(json);
  if (num > 0)
    await update_image_list(json);
};


async function sync_instagram(json){
  var album_list = await read_album_list();
  var media_list = await get_all_image_list(album_list, json.access_token);

  var instagram_list = await do_get(api_url + '/instagram-imagelist');
  var params = {
    albumId: album_list.id,
    newMediaItems: [],
  };
  for (const instagram of instagram_list.list) {
    var item = media_list.find(item => item.filename.startsWith("instagram_" + instagram.id + '.'));
    if (item)
      continue;
    var buffer = await do_get_buffer(instagram.media_url);
    //      console.log(buffer);

    var ftype = await filetype.fromBuffer(buffer);
    var uploadToken = await do_post_buffer('https://photoslibrary.googleapis.com/v1/uploads', buffer, ftype.mime, json.access_token);

    params.newMediaItems.push({
      simpleMediaItem: {
        fileName: 'instagram_' + instagram.id + '.' + ftype.ext,
        uploadToken: uploadToken
      }
    });
  }

  if (params.newMediaItems.length > 0) {
    var result2 = await do_post_with_token('https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate', params, json.access_token);
    console.log(result2);
  }

  console.log('success (' + params.newMediaItems.length + ')');

  return params.newMediaItems.length;
}

async function update_image_list(json){
  var list = await jsonfile.read_json(IMAGE_LIST_FILE_PATH, { data: [] });
  var album_list = await read_album_list();
  list.data = await get_all_image_list(album_list, json.access_token);
  list.update_at = new Date().getTime();
  await jsonfile.write_json(IMAGE_LIST_FILE_PATH, list);

  return list;
}

async function read_image_list(json){
  var list = await jsonfile.read_json(IMAGE_LIST_FILE_PATH, { data: [] });
  var date = new Date();
  if (!list.update_at || list.update_at < date.getTime() - UPDATE_IMAGE_LIST_INTERVAL) {
    list = await update_image_list(json);
  }

  return list;
}

async function read_album_list(){
  var album_list = await jsonfile.read_json(ALBUM_LIST_FILE_PATH);
  if (!album_list) {
    console.log('file is not ready.');
    throw 'file is not ready.';
  }

  return album_list;
}

async function read_token() {
  var json = await jsonfile.read_json(TOKEN_FILE_PATH);
  if (!json) {
    console.log('file is not ready.');
    throw 'file is not ready.';
  }

  var date = new Date();
  if (date.getTime() > json.created_at + json.expires_in * 1000 - 10 * 60 * 1000) {
    console.log('timeover');
    var params = {
      refresh_token: json.refresh_token
    };
    var result = await do_post_with_apikey(api_url + '/googleapi-refreshtoken', params, API_KEY);
    json.access_token = result.access_token;
    json.expires_in = result.expires_in;
    json.created_at = date.getTime();

    await jsonfile.write_json(TOKEN_FILE_PATH, json);

    await update_image_list(json);
  }

  return json;
}

function make_random(max) {
  return Math.floor(Math.random() * (max + 1));
}

async function get_all_image_list(album_list, access_token) {
  console.log(album_list, access_token);
  var params = {
    albumId: album_list.id,
    pageSize: 100
  }
  var result2 = await do_post_with_token('https://photoslibrary.googleapis.com/v1/mediaItems:search', params, access_token);
  var media_list = [];
  if (result2.mediaItems)
    media_list = result2.mediaItems;
  while (result2.nextPageToken) {
    params.pageToken = reulst2.nextPageToken;
    result2 = await do_post_with_token('https://photoslibrary.googleapis.com/v1/mediaItems:search', params, access_token);
    media_list = media_list.concat(result2.mediaItems);
  }

  for (var i = 0; i < album_list.list.length ; i++ ){
    var params2 = {
      albumId: album_list.list[i],
      pageSize: 100
    }
    var result3 = await do_post_with_token('https://photoslibrary.googleapis.com/v1/mediaItems:search', params2, access_token);
    if (result3.mediaItems)
      media_list = media_list.concat(result3.mediaItems);
    while (result3.nextPageToken) {
      params2.pageToken = reulst3.nextPageToken;
      result4 = await do_post_with_token('https://photoslibrary.googleapis.com/v1/mediaItems:search', params2, access_token);
      media_list = media_list.concat(result4.mediaItems);
    }
  }

  return media_list;
}

function do_post_with_apikey(url, body, apikey) {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "X-API-KEY" : apikey });

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

function do_post_with_token(url, body, token) {
  const headers = new Headers({ "Content-Type": "application/json", Authorization: "Bearer " + token });

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

function do_post_buffer(url, buffer, mimetype, token) {
  const headers = new Headers({ "Content-Type": "application/octet-stream", Authorization: 'Bearer ' + token, "X-Goog-Upload-Content-Type": mimetype, "X-Goog-Upload-Protocol": 'raw' });

  return fetch(url, {
    method: 'POST',
    body: buffer,
    headers: headers
  })
    .then((response) => {
      if (!response.ok)
        throw 'status is not 200';
      return response.text();
    });
}

function do_get(url, qs) {
  var params = new URLSearchParams(qs);

  return fetch(params.toString() ? url + `?` + params.toString() : url, {
    method: 'GET',
  })
    .then((response) => {
      if (!response.ok)
        throw 'status is not 200';
      return response.json();
    });
}

function do_get_buffer(url, qs) {
  var params = new URLSearchParams(qs);

  return fetch(params.toString() ? url + `?` + params.toString() : url, {
    method: 'GET',
  })
    .then((response) => {
      if (!response.ok)
        throw 'status is not 200';
//      return response.json();
      return response.arrayBuffer();
    });
}

function do_get_with_token(url, qs, token) {
  const params = new URLSearchParams(qs);
  const headers = new Headers({ Authorization: 'Bearer ' + token });

  return fetch(params.toString() ? url + `?` + params.toString() : url, {
    method: 'GET',
    headers: headers
  })
    .then((response) => {
      if (!response.ok)
        throw 'status is not 200';
      return response.json();
      //    return response.text();
      //    return response.blob();
      //    return response.arrayBuffer();
    });
}
