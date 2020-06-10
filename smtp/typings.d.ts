/* eslint-disable no-var */
declare module 'addressparser' {
	var addressparser: (
		address?: string | string[]
	) => { name: string; address: string }[];
	export = addressparser;
}

declare module 'emailjs-mime-codec' {
	var codec: {
		mimeWordEncode: (word?: string) => string;
	};
	export = codec;
}
