using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;

namespace PokeBonk.Client;

internal sealed class WecomHttpTransport : IWecomTransport, IDisposable
{
	private readonly HttpClient client;

	private readonly TimeSpan deadline;

	internal WecomHttpTransport(JsonObject network, HttpMessageHandler? handler = null)
	{
		deadline = TimeSpan.FromSeconds(WecomSettings.Number(network["timeoutSeconds"], 10, 3, 60));
		client = new HttpClient(handler ?? new HttpClientHandler
		{
			AllowAutoRedirect = false,
			UseProxy = (WecomSettings.Text(network["proxy"]) != "direct")
		})
		{
			Timeout = deadline
		};
	}

	public async Task<WecomReply> SendAsync(Uri address, string body, CancellationToken token)
	{
		WecomStorage.ValidateWebhook(address.AbsoluteUri);
		using (CancellationTokenSource fullDeadline = CancellationTokenSource.CreateLinkedTokenSource(token))
		{
			fullDeadline.CancelAfter(deadline);
			using HttpRequestMessage request = new HttpRequestMessage(HttpMethod.Post, address)
			{
				Content = new StringContent(new JsonObject
				{
					["msgtype"] = "text",
					["text"] = new JsonObject { ["content"] = body }
				}.ToJsonString(), Encoding.UTF8, "application/json")
			};
			_ = 3;
			try
			{
				using (HttpResponseMessage response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, fullDeadline.Token))
				{
					if (response.StatusCode == HttpStatusCode.TooManyRequests)
					{
						return new WecomReply("failed", "官方限流，等待一分钟后有限重试", Retry: true, Limited: true);
					}
					if (response.StatusCode >= HttpStatusCode.MultipleChoices && response.StatusCode < HttpStatusCode.BadRequest)
					{
						return new WecomReply("failed", "官方端点返回重定向，已拒绝跟随");
					}
					if (response.StatusCode >= HttpStatusCode.InternalServerError)
					{
						return new WecomReply("unknown", "服务端响应异常，是否已接收未知；不会自动重发");
					}
					WecomReply result;
					await using (Stream stream = await response.Content.ReadAsStreamAsync(fullDeadline.Token))
					{
						using MemoryStream memory = new MemoryStream();
						byte[] buffer = new byte[4096];
						while (memory.Length <= 65536)
						{
							int num = await stream.ReadAsync(buffer, fullDeadline.Token);
							if (num == 0)
							{
								break;
							}
							memory.Write(buffer, 0, num);
						}
						if (memory.Length > 65536)
						{
							result = new WecomReply("unknown", "官方响应超过安全长度，发送结果未知");
						}
						else
						{
							JsonObject jsonObject;
							try
							{
								jsonObject = JsonNode.Parse(memory.ToArray()) as JsonObject;
							}
							catch (JsonException)
							{
								result = new WecomReply("unknown", "官方响应无法确认，发送结果未知");
								goto end_IL_02a0;
							}
							result = ((jsonObject?["errcode"] is JsonValue jsonValue && jsonValue.TryGetValue<int>(out var value)) ? ((value == 0 && response.IsSuccessStatusCode) ? new WecomReply("success", "接口调用成功；不代表手机弹窗或已读") : (value switch
							{
								45009 => new WecomReply("failed", "官方分钟限流，等待一分钟后有限重试", Retry: true, Limited: true), 
								-1 => new WecomReply("failed", "官方系统繁忙，有限重试", Retry: true), 
								_ => new WecomReply("failed", "官方明确拒绝，错误码 " + value + "；请检查推送密钥、群权限与使用限制"), 
							})) : new WecomReply("unknown", "官方响应缺少业务状态，发送结果未知"));
						}
						end_IL_02a0:;
					}
					return result;
				}
				IL_05bc:;
			}
			catch (OperationCanceledException)
			{
				return token.IsCancellationRequested ? new WecomReply("cancelled", "已取消本地等待；已提交请求可能已被接收") : new WecomReply("unknown", "请求超时，发送结果未知；不会自动重发");
			}
			catch (HttpRequestException)
			{
				return new WecomReply("unknown", "网络请求中断，发送结果未知；不会自动重发");
			}
			catch
			{
				return new WecomReply("unknown", "无法确认发送结果；不会自动重发");
			}
		}
		throw null;
	}

	public void Dispose()
	{
		client.Dispose();
	}
}
