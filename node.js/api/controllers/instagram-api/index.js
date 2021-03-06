'use strict';

const HELPER_BASE = process.env.HELPER_BASE || '../../helpers/';
const Response = require(HELPER_BASE + 'response');
const BinResponse = require(HELPER_BASE + 'binresponse');

const IMAGE_LIST_FILE_PATH = process.env.THIS_BASE_PATH + '/data/instagram/image_list.json';
const TOKEN_FILE_PATH = process.env.THIS_BASE_PATH + '/data/instagram/access_token.json';
const UPDATE_INTERVAL = 60 * 60 * 24 * 1000;

const INITIAL_ACCESS_TOKEN = '【長期間アクセストークン】';

const image_list_url = 'https://graph.instagram.com/me/media';
const refresh_url = 'https://graph.instagram.com/refresh_access_token';

const fetch = require('node-fetch');
const sharp = require('sharp');
const fs = require('fs').promises;

exports.handler = async (event, context, callback) => {
	if( event.path == '/instagram-imagelist'){
		var json = await read_token();
		var list = await get_all_image_list(json.access_token);
		return new Response({ list: list.data });
	}else
	if (event.path == '/instagram-image') {
		const width = event.queryStringParameters.width ? Number(event.queryStringParameters.width) : 480;
		const height = event.queryStringParameters.height ? Number(event.queryStringParameters.height) : 320;
		const fit = event.queryStringParameters.fit || 'cover';

		var list = await read_image_list();
		var date = new Date();
		if (!list.update_at || list.update_at < date.getTime() - UPDATE_INTERVAL ){
			var json = await read_token();
			list = await get_all_image_list(json.access_token);
			await write_image_list(list);
		}

		if( list.data.length <= 0 )
			throw 'image_list is empty';

		var index = make_random(list.data.length - 1);
		var image = await do_get_buffer(list.data[index].media_url);

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
};

exports.trigger = async (event, context, callback) => {
	console.log('instagram cron triggered');
	var json = await read_token();

	var url = refresh_url + '?grant_type=ig_refresh_token&access_token=' + json.access_token;
	var result = await do_get(url);
	json.access_token = result.access_token;
	json.expires_in = result.expires_in;

	await write_token(json);
};

function make_random(max) {
	return Math.floor(Math.random() * (max + 1));
}

async function get_all_image_list(access_token){
	console.log("get_all_image_list called");
	var list = {
		data: []
	};
	var url = image_list_url + '?fields=id,caption,permalink,media_url&access_token=' + access_token;
	do{
		var json = await do_get(url);
		list.data = list.data.concat(json.data);
		if( !json.paging.next )
			break;
		url = json.paging.next;
	}while(true);

	return list;
}

async function read_token(){
	try{
		var result = await fs.readFile(TOKEN_FILE_PATH);
		return JSON.parse(result);
	}catch(error){
		return {
			access_token: INITIAL_ACCESS_TOKEN
		};
	}
}

async function write_token(json){
	await fs.writeFile(TOKEN_FILE_PATH, JSON.stringify(json, null, '\t'));
}

async function write_image_list(list){
	var date = new Date();
	list.update_at = date.getTime();
	return fs.writeFile(IMAGE_LIST_FILE_PATH, JSON.stringify(list, null, '\t'));
}

async function read_image_list(){
	try{
		var list = await fs.readFile(IMAGE_LIST_FILE_PATH, 'utf-8');
		return JSON.parse(list);
	}catch(error){
		return {
			data: []
		};
	}
}

function do_get(url) {
	return fetch(url, {
		method: 'GET',
	})
		.then((response) => {
			if (!response.ok)
				throw 'status is not 200';
			return response.json();
		});
}

function do_get_buffer(url) {
	return fetch(url, {
		method: 'GET',
	})
		.then((response) => {
			if (!response.ok)
				throw 'status is not 200';
			return response.arrayBuffer();
		});
}
