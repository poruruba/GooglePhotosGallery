'use strict';

const HELPER_BASE = process.env.HELPER_BASE || '../../helpers/';
const Response = require(HELPER_BASE + 'response');
const jsonfile = require(HELPER_BASE + 'jsonfile-utils');

const CLIENT_ID = '【クライアントID】';
const CLIENT_SECRET = '【クライアントシークレット】';

const TOKEN_FILE_PATH = process.env.THIS_BASE_PATH + '/data/googlephotos/access_token.json';
const EVENT_LIST_FILE_PATH = process.env.THIS_BASE_PATH + '/data/googlecalendar/event_list.json';
const CALENDAR_WEBHOOK_URL = 'https://【Node.jsサーバのホスト名】/googlecalendar-webhooks';

const API_KEY = "【適当なAPIキー】";
const api_url = 'https://【Node.jsサーバのホスト名】';

const mqtt_url = "mqtt://【MQTTブローカのホスト名】:1883";
const TOPIC_CMD = 'calendar/notify';

const mqtt = require('mqtt')
const { v4: uuidv4 } = require('uuid');
const jwt_decode = require('jwt-decode');
const { google } = require('googleapis');

const { URL, URLSearchParams } = require('url');
const fetch = require('node-fetch');
const Headers = fetch.Headers;

const client = mqtt.connect(mqtt_url);

exports.handler = async (event, context, callback) => {
  switch (event.path) {
    case '/googletasks-list': {
      var token = await read_token();
      const tasks = get_tasks(token);
      var list = await get_tasklist_list(tasks);
      console.log(list);
      for( var i = 0 ; i < list.length ; i++ ){
        list[i].list = await get_task_list(tasks, list[i].id);
      }
      return new Response({ list: list });
    }
    case '/googlecalendar-list': {
      var body = JSON.parse(event.body);
      console.log(body);
      var token = await read_token();

      const calendar = get_calendar(token);
      if( body.date ){
        var date = new Date(Number(body.date));
        console.log(date.toLocaleString());
        var list = await get_event_list(calendar, date);
        return new Response({ list: list });
      }else{
        var list = await read_event_list(calendar);
        return new Response({ list: list.list } );
      }
    }
    case '/googlecalendar-webhooks': {
      console.log(event);
      if( event.headers['x-goog-resource-state'] == 'exists'){
        var token = await read_token();
        const calendar = get_calendar(token);
        var list = await read_event_list(calendar, true);

        client.publish(TOPIC_CMD, "1");
      }
      return new Response({});
    }
    case '/googlecalendar-register-webhooks': {
      var json = await jsonfile.read_json(EVENT_LIST_FILE_PATH, { list: [] });
      if( json.notification ){
        throw 'notification already registered';
      }

      var token = await read_token();
      var params = {
        id: uuidv4(),
        type: "web_hook",
        address: CALENDAR_WEBHOOK_URL
      };
      const decoded = jwt_decode(token.id_token);
      var result = await do_post_with_token('https://www.googleapis.com/calendar/v3/calendars/' + decoded.email + '/events/watch', params, token.access_token);
      console.log(result);

      json.notification = result;
      await jsonfile.write_json(EVENT_LIST_FILE_PATH, json);

      return new Response({});
    }
    case '/googlecalendar-unregister-webhooks': {
      var json = await jsonfile.read_json(EVENT_LIST_FILE_PATH, { list: [] });
      if (!json.notification) {
        throw 'notification not registered';
      }

      var token = await read_token();
      var params = {
        id: json.notification.id,
        resourceId: json.notification.resourceId
      };
      var result = await do_post_text_with_token('https://www.googleapis.com/calendar/v3/channels/stop', params, token.access_token);
      console.log(result);

      json.notification = null;
      await jsonfile.write_json(EVENT_LIST_FILE_PATH, json);

      return new Response({});
    }
  }
};

exports.trigger = async (event, context, callback) => {
  console.log('googlecalendar.trigger cron triggered');

  var token = await read_token();
  const calendar = get_calendar(token);
  var list = await read_event_list(calendar, true);

  console.log(list);
};

function get_calendar(token){
  const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
  oAuth2Client.setCredentials(token);
  return google.calendar({ version: 'v3', auth: oAuth2Client });
}

function get_tasks(token) {
  const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
  oAuth2Client.setCredentials(token);
  return google.tasks({ version: 'v1', auth: oAuth2Client });
}

function to2d(val){
  return ('0' + val).slice(-2);
}

function convert_date(start, end){
  var term = {};

  if( start.date ){
    term.type = 'date';

    var startDate = new Date(start.date);
    startDate.setHours(startDate.getHours() - 9);
    startDate.setHours(0);
    startDate.setMinutes(0);
    startDate.setSeconds(0);
    startDate.setMilliseconds(0);
    term.start = Math.floor(startDate.getTime() / 1000);
    term.date_str = startDate.getFullYear() + '/' + to2d(startDate.getMonth() + 1) + '/' + to2d(startDate.getDate());

    var endDate = new Date(end.date);
    endDate.setHours(endDate.getHours() - 9);
    endDate.setHours(23);
    endDate.setMinutes(59);
    endDate.setSeconds(59);
    endDate.setMilliseconds(999);
    term.end = Math.floor(endDate.getTime() / 1000);
  }else{
    term.type = 'dateTime';

    var startDate = new Date(start.dateTime);
    term.start = Math.floor(startDate.getTime() / 1000);
    var endDate = new Date(end.dateTime);
    term.end = Math.floor(endDate.getTime() / 1000);

    term.date_str = startDate.getFullYear() + '/' + to2d(startDate.getMonth() + 1) + '/' + to2d(startDate.getDate());
    term.time_str = to2d(startDate.getHours()) + ':' + to2d(startDate.getMinutes()) + '-' + to2d(endDate.getHours()) + ':' + to2d(endDate.getMinutes());
  }
  
  return term;
}

async function get_tasklist_list(tasks){
  var params = {};
  var result = await new Promise((resolve, reject) => {
    tasks.tasklists.list(params, (err, res) => {
      if (err)
        return reject(err);
      resolve(res);
    });
  });
  var items = result.data.items;
  while (result.nextPageToken) {
    params.pageToken = result.nextPageToken;
    result = await new Promise((resolve, reject) => {
      tasks.tasklists.list(params, (err, res) => {
        if (err)
          return reject(err);
        resolve(res);
      });
    });
    items = items.concat(result.data.items);
  }

  var list = [];
  for (const item of items) {
    list.push({
      title: item.title,
      id: item.id
    });
  }

  return list;
}

async function get_task_list(tasks, id) {
  var params = {
    tasklist: id
  };
  var result = await new Promise((resolve, reject) => {
    tasks.tasks.list(params, (err, res) => {
      if (err)
        return reject(err);
      resolve(res);
    });
  });
  var items = result.data.items || [];
  while (result.nextPageToken) {
    params.pageToken = result.nextPageToken;
    result = await new Promise((resolve, reject) => {
      tasks.tasks.list(params, (err, res) => {
        if (err)
          return reject(err);
        resolve(res);
      });
    });
    items = items.concat(result.data.items);
  }

  var list = [];
  for (const item of items) {
    list.push({
      title: item.title,
      notes: item.notes,
      id: item.id,
      parent: item.parent || null,
      due: item.due ? new Date(item.due).getTime() : null
    });
  }

  return list;
}

async function get_event_list(calendar, date){
  var startTime = date.toISOString();
  var endDate = new Date(date.getTime());
  endDate.setHours(23);
  endDate.setMinutes(59);
  endDate.setSeconds(59);
  endDate.setMilliseconds(999);
  var endTime = endDate.toISOString();

  var params = {
    calendarId: 'primary',
    timeMin: startTime,
    timeMax: endTime,
    singleEvents: true,
    orderBy: 'startTime',
  };
  var result = await new Promise((resolve, reject) => {
    calendar.events.list(params, (err, res) => {
      if (err)
        return reject(err);
      resolve(res);
    });
  });
  var items = result.data.items || [];
  while (result.nextPageToken) {
    params.pageToken = result.nextPageToken;
    result = await new Promise((resolve, reject) => {
      calendar.events.list(params, (err, res) => {
        if (err)
          return reject(err);
        resolve(res);
      });
    });
    items = items.concat(result.data.items);
  }

  var list = [];
  for (const item of items) {
    var term = convert_date(item.start, item.end);
    list.push({
      summary: item.summary,
      term: term
    });
  }

  return list;
}

async function read_event_list(calendar, force){
  var json = await jsonfile.read_json(EVENT_LIST_FILE_PATH, { list: [] });
  var date = new Date();
  if (force || !json.update_at || new Date(json.update_at).getDate() != date.getDate() ){
    console.log('update event_list');

    json.list = await get_event_list(calendar, date);
    json.update_at = date.getTime();
    await jsonfile.write_json(EVENT_LIST_FILE_PATH, json);
  }

  return json;
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
  }

  return json;
}

function do_post_with_apikey(url, body, apikey) {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "X-API-KEY": apikey });

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

function do_post_text_with_token(url, body, token) {
  const headers = new Headers({ "Content-Type": "application/json", Authorization: "Bearer " + token });

  return fetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: headers
  })
    .then((response) => {
      if (!response.ok)
        throw 'status is not 200';
      return response.text();
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